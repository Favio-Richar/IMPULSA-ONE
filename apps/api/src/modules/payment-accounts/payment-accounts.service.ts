import { randomBytes } from "node:crypto";
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { decryptSecret, encryptSecret } from "@impulza/auth";
import type { PaymentAccountConnectResponse, PaymentAccountsResponse } from "@impulza/contracts";
import { MembershipStatus, PaymentAccountStatus, PERMISSIONS, type PrismaClient } from "@impulza/database";
import { codeChallengeFor, createCodeVerifier, type MercadoPagoOAuthLike, PaymentGatewayError } from "@impulza/payments";
import type { Redis } from "ioredis";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { REDIS } from "../../redis/redis.module.js";
import { AuditService } from "../audit/audit.service.js";
import { MERCADO_PAGO_OAUTH } from "./payment-accounts.tokens.js";

/** El `state` de OAuth vive 10 minutos y se usa una sola vez. */
const STATE_TTL_SECONDS = 600;
const STATE_PREFIX = "mp-oauth-state:";

/** Resultado al volver de Mercado Pago, que el panel muestra en "Cobros". */
export type ConnectOutcome = "conectada" | "cancelada" | "vencida" | "sin-permiso" | "error";

interface PendingConnection {
  organizationId: string;
  userId: string;
  codeVerifier: string;
}

/**
 * Cuenta de Mercado Pago del negocio (F5.8, ADR-013). OAuth con PKCE y `state` de un solo uso: el
 * `state` es un valor aleatorio que se guarda en Redis con quién y para qué organización se pidió; al
 * volver se consume (GETDEL) — un `state` repetido, ajeno o vencido no conecta nada. El permiso se
 * vuelve a comprobar al volver: pudo cambiar el rol mientras la persona estaba en Mercado Pago.
 */
@Injectable()
export class PaymentAccountsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MERCADO_PAGO_OAUTH) private readonly oauth: MercadoPagoOAuthLike | null,
    private readonly audit: AuditService,
  ) {}

  available(): boolean {
    return Boolean(this.oauth && env.API_PUBLIC_URL);
  }

  private redirectUri(): string {
    return `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/payments/mercadopago/oauth/callback`;
  }

  async status(organizationId: string, roleId: string): Promise<PaymentAccountsResponse> {
    const [account, grant] = await Promise.all([
      this.prisma.paymentAccount.findUnique({ where: { organizationId_provider: { organizationId, provider: "MERCADO_PAGO" } } }),
      this.prisma.rolePermission.findFirst({ where: { roleId, permission: { key: PERMISSIONS.PAYMENTS_CONNECT } } }),
    ]);
    return {
      available: this.available(),
      canManage: grant !== null,
      mercadoPago: account
        ? { status: account.status, liveMode: account.liveMode, connectedAt: account.connectedAt.toISOString(), expiresAt: account.expiresAt.toISOString() }
        : null,
    };
  }

  async startConnect(organizationId: string, userId: string): Promise<PaymentAccountConnectResponse> {
    if (!this.available()) {
      throw new UnprocessableEntityException({ code: "PAYMENTS_UNAVAILABLE", message: "La conexión con Mercado Pago no está disponible por ahora." });
    }
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = createCodeVerifier();
    const pending: PendingConnection = { organizationId, userId, codeVerifier };
    await this.redis.set(`${STATE_PREFIX}${state}`, JSON.stringify(pending), "EX", STATE_TTL_SECONDS);
    return { url: this.oauth!.authorizationUrl({ state, codeChallenge: codeChallengeFor(codeVerifier), redirectUri: this.redirectUri() }) };
  }

  async completeConnect(input: { code?: string; state?: string; error?: string }): Promise<ConnectOutcome> {
    if (!this.oauth || !input.state || input.state.length > 100) return "error";
    // Un solo uso: se consume antes de mirar nada más.
    const raw = await this.redis.getdel(`${STATE_PREFIX}${input.state}`);
    if (!raw) return "vencida";
    const pending = JSON.parse(raw) as PendingConnection;
    if (input.error || !input.code) return "cancelada";

    // El permiso se comprueba de nuevo: pudo cambiar mientras estaba en Mercado Pago.
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: pending.userId, organizationId: pending.organizationId } },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const allowed =
      membership?.status === MembershipStatus.ACTIVE && membership.role.permissions.some((grant) => grant.permission.key === PERMISSIONS.PAYMENTS_CONNECT);
    if (!allowed) return "sin-permiso";

    let tokens;
    try {
      tokens = await this.oauth.exchangeCode({ code: input.code, codeVerifier: pending.codeVerifier, redirectUri: this.redirectUri() });
    } catch (error) {
      logger.warn("payments: Mercado Pago no aceptó el código de conexión", { organizationId: pending.organizationId, code: error instanceof PaymentGatewayError ? error.code : "unknown" });
      return "error";
    }

    const data = {
      providerUserId: tokens.providerUserId,
      accessTokenEncrypted: encryptSecret(tokens.accessToken, env.AUTH_ENCRYPTION_KEY),
      refreshTokenEncrypted: encryptSecret(tokens.refreshToken, env.AUTH_ENCRYPTION_KEY),
      expiresAt: tokens.expiresAt,
      liveMode: tokens.liveMode,
      status: PaymentAccountStatus.CONNECTED,
      lastError: null,
      connectedById: pending.userId,
      connectedAt: new Date(),
      lastRefreshedAt: null,
    };
    await this.prisma.paymentAccount.upsert({
      where: { organizationId_provider: { organizationId: pending.organizationId, provider: "MERCADO_PAGO" } },
      create: { organizationId: pending.organizationId, provider: "MERCADO_PAGO", ...data },
      update: data,
    });
    await this.audit.record({
      organizationId: pending.organizationId,
      actorId: pending.userId,
      action: "payments.account_connected",
      targetType: "payment_account",
      metadata: { provider: "MERCADO_PAGO", liveMode: tokens.liveMode },
    });
    logger.info("payments: cuenta de Mercado Pago conectada", { organizationId: pending.organizationId, liveMode: tokens.liveMode });
    return "conectada";
  }

  /** Desconectar: se borran los tokens. Desde ese momento los cobros vuelven a enlaces externos. */
  async disconnect(organizationId: string, userId: string): Promise<void> {
    const deleted = await this.prisma.paymentAccount.deleteMany({ where: { organizationId, provider: "MERCADO_PAGO" } });
    if (deleted.count === 0) throw new NotFoundException({ code: "NOT_CONNECTED", message: "No hay una cuenta de Mercado Pago conectada." });
    await this.audit.record({ organizationId, actorId: userId, action: "payments.account_disconnected", targetType: "payment_account", metadata: { provider: "MERCADO_PAGO" } });
    logger.info("payments: cuenta de Mercado Pago desconectada", { organizationId });
  }

  /**
   * Token vigente para cobrar a nombre del negocio, o `null` si no hay cuenta conectada y sana. Solo
   * lo usan los cobros de **esa** organización (ADR-013, restricciones).
   */
  async accessTokenFor(organizationId: string): Promise<string | null> {
    const account = await this.prisma.paymentAccount.findUnique({ where: { organizationId_provider: { organizationId, provider: "MERCADO_PAGO" } } });
    if (!account || account.status !== PaymentAccountStatus.CONNECTED || account.expiresAt <= new Date()) return null;
    return decryptSecret(account.accessTokenEncrypted, env.AUTH_ENCRYPTION_KEY);
  }
}
