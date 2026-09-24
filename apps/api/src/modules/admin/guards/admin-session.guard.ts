import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { type PrismaClient, SessionScope } from "@impulza/database";
import type { Request } from "express";
import type { RequestWithUser } from "../../../common/request-with-user.js";
import { PRISMA } from "../../../database/prisma.module.js";
import { ADMIN_SESSION_COOKIE_NAME } from "../admin-session-cookie.js";

const INVALID_ADMIN_SESSION = "Sesión de administración inválida o expirada.";

/**
 * Puerta de toda ruta `/admin/*` salvo el login (ADR-005 §4). No comparte camino con
 * `SessionAuthGuard` ni con `OrganizationMembershipGuard` (ADR-002 §4): lee su propia cookie, exige
 * una sesión `ADMIN` y vuelve a comprobar `isSuperAdmin` y 2FA en **cada** petición, así revocar
 * con el script tiene efecto inmediato aunque la sesión no haya vencido.
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const sessionId: unknown = request.cookies?.[ADMIN_SESSION_COOKIE_NAME];

    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new UnauthorizedException(INVALID_ADMIN_SESSION);
    }

    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } }).catch(() => null);

    if (
      !session ||
      session.scope !== SessionScope.ADMIN ||
      session.expiresAt.getTime() < Date.now() ||
      !session.user.isSuperAdmin ||
      !session.user.twoFactorEnabled
    ) {
      throw new UnauthorizedException(INVALID_ADMIN_SESSION);
    }

    const requestWithUser = request as RequestWithUser;
    requestWithUser.user = session.user;
    requestWithUser.session = session;

    return true;
  }
}
