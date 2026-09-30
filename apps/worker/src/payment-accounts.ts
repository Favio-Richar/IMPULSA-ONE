import { decryptSecret, encryptSecret, type EmailAdapter } from "@impulza/auth";
import { PaymentAccountStatus, type PrismaClient } from "@impulza/database";
import { type MercadoPagoOAuthLike, PaymentGatewayError } from "@impulza/payments";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

// Renovación de las cuentas de Mercado Pago conectadas por los negocios (F5.8, ADR-013). El token
// dura 180 días: se renueva 30 días antes. Si Mercado Pago rechaza la renovación (el negocio revocó
// el acceso), la cuenta queda en ERROR y se avisa al dueño — nunca se cobra con un token vencido.

export const PAYMENT_ACCOUNTS_QUEUE = "payment-accounts-refresh";
const DAY_MS = 24 * 60 * 60 * 1000;
const RENEW_BEFORE_MS = 30 * DAY_MS;
const BATCH = 100;

export interface RefreshOptions {
  oauth: MercadoPagoOAuthLike;
  email: EmailAdapter;
  encryptionKey: string;
  dashboardBaseUrl?: string;
  /** Acota a estas organizaciones (operación puntual y pruebas); sin él, toda la plataforma. */
  scope?: { organizationIds: string[] };
  now?: Date;
}

export interface RefreshResult {
  renewed: number;
  failed: number;
}

export async function refreshPaymentAccounts(prisma: PrismaClient, options: RefreshOptions): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const scope = options.scope ? { organizationId: { in: options.scope.organizationIds } } : {};
  const due = await prisma.paymentAccount.findMany({
    where: { ...scope, provider: "MERCADO_PAGO", status: PaymentAccountStatus.CONNECTED, expiresAt: { lte: new Date(now.getTime() + RENEW_BEFORE_MS) } },
    include: { organization: { select: { name: true } } },
    orderBy: { expiresAt: "asc" },
    take: BATCH,
  });

  const result: RefreshResult = { renewed: 0, failed: 0 };
  for (const account of due) {
    try {
      const tokens = await options.oauth.refresh(decryptSecret(account.refreshTokenEncrypted, options.encryptionKey), now);
      // Condicional sobre el token leído: si otro proceso renovó o el negocio desconectó entre medio,
      // no se pisa nada.
      await prisma.paymentAccount.updateMany({
        where: { id: account.id, refreshTokenEncrypted: account.refreshTokenEncrypted },
        data: {
          accessTokenEncrypted: encryptSecret(tokens.accessToken, options.encryptionKey),
          refreshTokenEncrypted: encryptSecret(tokens.refreshToken, options.encryptionKey),
          expiresAt: tokens.expiresAt,
          liveMode: tokens.liveMode,
          lastRefreshedAt: now,
          lastError: null,
        },
      });
      result.renewed += 1;
    } catch (error) {
      const definitive = error instanceof PaymentGatewayError && !error.retryable;
      const expired = account.expiresAt <= now;
      if (!definitive && !expired) {
        // Falla pasajera y todavía vigente: se reintenta en la próxima pasada.
        logger.warn("payments.account.refresh_retry", { accountId: account.id, code: error instanceof PaymentGatewayError ? error.code : "unknown" });
        continue;
      }
      const reason = definitive ? "refresh_rejected" : "expired";
      const moved = await prisma.paymentAccount.updateMany({
        where: { id: account.id, status: PaymentAccountStatus.CONNECTED },
        data: { status: PaymentAccountStatus.ERROR, lastError: reason },
      });
      if (moved.count === 1) {
        result.failed += 1;
        await notifyOwners(prisma, options, account.organizationId, account.organization.name);
        logger.warn("payments.account.disconnected", { accountId: account.id, reason });
      }
    }
  }
  return result;
}

async function notifyOwners(prisma: PrismaClient, options: RefreshOptions, organizationId: string, organizationName: string): Promise<void> {
  const owners = await prisma.membership.findMany({
    where: { organizationId, status: "ACTIVE", role: { name: "OWNER" } },
    select: { user: { select: { email: true } } },
  });
  const link = options.dashboardBaseUrl ? `${options.dashboardBaseUrl.replace(/\/+$/, "")}/cobros` : null;
  const text = [
    `Hola, ${organizationName}:`,
    "",
    "Perdimos la conexión con tu cuenta de Mercado Pago (se revocó el acceso o venció). Mientras no la reconectes, tu página ofrece el enlace de pago que hayas configurado en vez del cobro automático.",
    "",
    "Reconectarla toma un minuto: entra a \"Cobros\" en tu panel y presiona \"Conectar Mercado Pago\".",
    ...(link ? ["", `Cobros: ${link}`] : []),
  ].join("\n");
  for (const owner of owners) {
    await options.email.send({ to: owner.user.email, subject: "Reconecta tu cuenta de Mercado Pago", text }).catch(() => undefined);
  }
}

export interface PaymentAccountWorkers {
  close(): Promise<void>;
}

/** Una pasada diaria basta: se renueva con 30 días de margen. */
export async function startPaymentAccountWorkers(options: RefreshOptions & { prisma: PrismaClient; connection: ConnectionOptions }): Promise<PaymentAccountWorkers> {
  const queue = new Queue(PAYMENT_ACCOUNTS_QUEUE, { connection: options.connection });
  await queue.upsertJobScheduler("payment-accounts-daily", { pattern: "0 30 4 * * *" }, { name: "refresh-payment-accounts" });
  const worker = new Worker(
    PAYMENT_ACCOUNTS_QUEUE,
    async () => {
      const result = await refreshPaymentAccounts(options.prisma, options);
      if (result.renewed + result.failed > 0) logger.info("payments.accounts.refresh_done", { ...result });
      return result;
    },
    { connection: options.connection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => logger.error("payments.accounts.refresh_failed", { jobId: job?.id, err: error }));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
