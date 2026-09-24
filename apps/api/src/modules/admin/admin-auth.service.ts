import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { decryptSecret, hashToken, verifyTwoFactorCode } from "@impulza/auth";
import { type PrismaClient, type Session, SessionScope, type User } from "@impulza/database";
import type { Redis } from "ioredis";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { REDIS } from "../../redis/redis.module.js";
import { AuditService } from "../audit/audit.service.js";
import { AuthService, type SessionContext } from "../auth/auth.service.js";
import { ADMIN_SESSION_TTL_MS } from "./admin-session-cookie.js";

/** Mismo texto para todo fallo: cuenta inexistente, contraseña, código o cuenta sin la marca. Un
 *  atacante no debe poder distinguir "acerté la contraseña" de "esta cuenta no es admin". */
const INVALID_ADMIN_CREDENTIALS = "Credenciales de administración inválidas.";

/** Un código TOTP vale ~30 s (más la tolerancia de otplib). Recordarlo 2 minutos cubre la ventana
 *  completa: un código ya usado no puede reutilizarse aunque alguien lo haya visto. */
const USED_CODE_TTL_SECONDS = 120;

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  async login(email: string, password: string, code: string, context: SessionContext): Promise<{ session: Session; user: User }> {
    let user: User;
    try {
      // Contraseña + bloqueo por intentos (F1.4), compartidos con el login del panel.
      user = await this.authService.verifyCredentials(email, password);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException(INVALID_ADMIN_CREDENTIALS);
      }
      throw error; // 403 de cuenta bloqueada temporalmente: ese sí se informa tal cual.
    }

    if (!user.isSuperAdmin || !user.twoFactorEnabled || !user.twoFactorSecretEncrypted) {
      // Una cuenta normal con la contraseña correcta intentando entrar a la administración es
      // exactamente lo que hay que ver en la auditoría.
      await this.auditService.record({
        actorId: user.id,
        action: "admin.login_denied",
        targetType: "User",
        targetId: user.id,
        metadata: { reason: user.isSuperAdmin ? "two_factor_missing" : "not_super_admin" },
      });
      throw new UnauthorizedException(INVALID_ADMIN_CREDENTIALS);
    }

    const secret = decryptSecret(user.twoFactorSecretEncrypted, env.AUTH_ENCRYPTION_KEY);
    const codeValid = await verifyTwoFactorCode(secret, code);
    // SET NX: si el código ya se usó dentro de su ventana, no vale otra vez (anti-repetición).
    const firstUse = codeValid ? (await this.redis.set(`admin-totp-used:${user.id}:${code}`, "1", "EX", USED_CODE_TTL_SECONDS, "NX")) === "OK" : false;

    if (!codeValid || !firstUse) {
      // Un código incorrecto cuenta como intento fallido: con la contraseña ya adivinada, probar
      // códigos al azar sigue topando con el bloqueo de 5 intentos.
      await this.authService.registerFailedLogin(user);
      logger.warn("login de superadministración con código 2FA inválido o repetido", { userId: user.id, reused: codeValid && !firstUse });
      throw new UnauthorizedException(INVALID_ADMIN_CREDENTIALS);
    }

    await this.authService.clearFailedLogins(user);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        scope: SessionScope.ADMIN,
        expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS),
        userAgent: context.userAgent,
        ipHash: context.ip ? hashToken(context.ip) : undefined,
      },
    });

    await this.auditService.record({
      actorId: user.id,
      action: "admin.login",
      targetType: "Session",
      targetId: session.id,
    });

    return { session, user };
  }

  async logout(session: Session): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: session.id, scope: SessionScope.ADMIN } });
    await this.auditService.record({
      actorId: session.userId,
      action: "admin.logout",
      targetType: "Session",
      targetId: session.id,
    });
  }
}
