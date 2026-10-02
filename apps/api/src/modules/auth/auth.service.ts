import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  decryptSecret,
  encryptSecret,
  generateTwoFactorSecret,
  generateVerificationToken,
  hashPassword,
  hashToken,
  verifyPassword,
  verifyTwoFactorCode,
  type EmailAdapter,
} from "@impulza/auth";
import { type PrismaClient, type Session, SessionScope, type User, VerificationTokenType } from "@impulza/database";
import { DEFAULT_PLATFORM_BRANDING } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "./email-adapter.token.js";
import { SESSION_TTL_MS } from "./session-cookie.js";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutos

// Mensaje deliberadamente genérico — nunca revelar si el email existe o si fue la contraseña
// la que falló (previene enumeración de cuentas).
const INVALID_CREDENTIALS_MESSAGE = "Credenciales inválidas.";

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: EmailAdapter,
    private readonly auditService: AuditService,
  ) {}

  async register(email: string, password: string): Promise<{ userId: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Aquí sí se puede confirmar duplicado: es el propio flujo de registro, no un endpoint de
      // login/recuperación donde eso habilitaría enumeración de terceros.
      throw new ConflictException("Ya existe una cuenta con este correo.");
    }

    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: { email, passwordHash },
    });

    await this.sendVerificationEmail(user);

    return { userId: user.id };
  }

  private async getBrandName(): Promise<string> {
    try {
      const branding = await this.prisma.platformBranding.findFirst({ select: { name: true } });
      return branding?.name ?? DEFAULT_PLATFORM_BRANDING.name;
    } catch {
      return DEFAULT_PLATFORM_BRANDING.name;
    }
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    const { raw, hash } = generateVerificationToken();
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        type: VerificationTokenType.EMAIL_VERIFICATION,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });

    const brandName = await this.getBrandName();
    const verifyUrl = `${env.APP_BASE_URL}/verificar-correo?token=${raw}`;
    await this.emailAdapter.send({
      to: user.email,
      subject: `Verifica tu correo — ${brandName}`,
      text: `Confirma tu correo entrando a este enlace: ${verifyUrl}\n\nExpira en 24 horas.`,
    });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const token = await this.consumeToken(rawToken, VerificationTokenType.EMAIL_VERIFICATION);
    await this.prisma.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  /**
   * Correo + contraseña, con el bloqueo por intentos fallidos (F1.4). Compartido por el login del
   * panel y el de superadministración (ADR-005): los dos caminos cuentan los mismos intentos, así
   * que probar contraseñas en la puerta de administración también bloquea la cuenta.
   */
  async verifyCredentials(email: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException(
        "Cuenta bloqueada temporalmente por demasiados intentos fallidos. Intenta más tarde.",
      );
    }

    const passwordValid = await verifyPassword(user.passwordHash, password);
    if (!passwordValid) {
      await this.registerFailedLogin(user);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    return user;
  }

  /** Limpia el contador de intentos una vez que el login completo (con 2FA, si aplica) salió bien. */
  async clearFailedLogins(user: User): Promise<void> {
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }
  }

  async login(email: string, password: string, context: SessionContext): Promise<{ session: Session; user: User }> {
    const user = await this.verifyCredentials(email, password);
    await this.clearFailedLogins(user);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        scope: SessionScope.USER,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: context.userAgent,
        ipHash: context.ip ? hashToken(context.ip) : undefined,
      },
    });

    return { session, user };
  }

  async registerFailedLogin(user: User): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
      },
    });

    if (shouldLock) {
      // "login fallido repetido" (F1.7) — sin actor autenticado real: nadie demostró identidad,
      // el evento es sobre la cuenta objetivo, no una acción que alguien "hizo" con autoridad.
      await this.auditService.record({
        actorId: null,
        action: "auth.account_locked",
        targetType: "User",
        targetId: user.id,
        metadata: { attempts: MAX_FAILED_LOGIN_ATTEMPTS },
      });
    }
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Respuesta idéntica exista o no la cuenta — nunca revelar qué correos están registrados.
    if (!user) {
      return;
    }

    const { raw, hash } = generateVerificationToken();
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        type: VerificationTokenType.PASSWORD_RESET,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    const brandName = await this.getBrandName();
    const resetUrl = `${env.APP_BASE_URL}/restablecer-contrasena?token=${raw}`;
    await this.emailAdapter.send({
      to: user.email,
      subject: `Recupera tu contraseña — ${brandName}`,
      text: `Restablece tu contraseña entrando a este enlace: ${resetUrl}\n\nExpira en 1 hora. Si no fuiste tú, ignora este correo.`,
    });
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const token = await this.consumeToken(rawToken, VerificationTokenType.PASSWORD_RESET);
    const passwordHash = await hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      // Cambiar la contraseña revoca todas las sesiones activas — si alguien más tenía acceso,
      // pierde la sesión (ST §15).
      this.prisma.session.deleteMany({ where: { userId: token.userId } }),
      // Invalida cualquier otro token de reseteo pendiente para esta cuenta.
      this.prisma.verificationToken.updateMany({
        where: {
          userId: token.userId,
          type: VerificationTokenType.PASSWORD_RESET,
          usedAt: null,
        },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.auditService.record({
      actorId: token.userId,
      action: "auth.password_reset",
      targetType: "User",
      targetId: token.userId,
    });
  }

  private async consumeToken(
    rawToken: string,
    type: VerificationTokenType,
  ): Promise<{ userId: string }> {
    const tokenHash = hashToken(rawToken);
    const token = await this.prisma.verificationToken.findUnique({ where: { tokenHash } });

    if (
      !token ||
      token.type !== type ||
      token.usedAt !== null ||
      token.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException("El enlace es inválido o ya expiró.");
    }

    await this.prisma.verificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    return { userId: token.userId };
  }

  async listSessions(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, scope: SessionScope.USER },
      orderBy: { createdAt: "desc" },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    // Nunca confiar en sessionId sin verificar propiedad — mismo principio que organization_id
    // en ADR-002, aplicado a nivel de usuario.
    const result = await this.prisma.session.deleteMany({
      where: { id: sessionId, userId, scope: SessionScope.USER },
    });

    if (result.count === 0) {
      throw new UnauthorizedException("La sesión no existe o no te pertenece.");
    }
  }

  async setupTwoFactor(user: User): Promise<{ secret: string; otpauthUrl: string }> {
    const { secret, otpauthUrl } = generateTwoFactorSecret(user.email);
    const encrypted = encryptSecret(secret, env.AUTH_ENCRYPTION_KEY);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecretEncrypted: encrypted, twoFactorEnabled: false },
    });

    return { secret, otpauthUrl };
  }

  async enableTwoFactor(user: User, code: string): Promise<void> {
    const secret = this.decryptUserSecret(user);
    const valid = await verifyTwoFactorCode(secret, code);
    if (!valid) {
      throw new UnauthorizedException("Código de verificación incorrecto.");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });

    await this.auditService.record({
      actorId: user.id,
      action: "auth.two_factor_enabled",
      targetType: "User",
      targetId: user.id,
    });
  }

  async disableTwoFactor(user: User, code: string): Promise<void> {
    const secret = this.decryptUserSecret(user);
    const valid = await verifyTwoFactorCode(secret, code);
    if (!valid) {
      throw new UnauthorizedException("Código de verificación incorrecto.");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecretEncrypted: null },
    });

    await this.auditService.record({
      actorId: user.id,
      action: "auth.two_factor_disabled",
      targetType: "User",
      targetId: user.id,
    });
  }

  private decryptUserSecret(user: User): string {
    if (!user.twoFactorSecretEncrypted) {
      throw new UnauthorizedException("2FA no está configurado para esta cuenta.");
    }
    return decryptSecret(user.twoFactorSecretEncrypted, env.AUTH_ENCRYPTION_KEY);
  }
}
