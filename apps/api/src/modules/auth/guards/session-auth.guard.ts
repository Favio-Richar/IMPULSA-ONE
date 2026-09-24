import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { type PrismaClient, SessionScope } from "@impulza/database";
import type { Request } from "express";
import { PRISMA } from "../../../database/prisma.module.js";
import type { RequestWithUser } from "../../../common/request-with-user.js";
import { SESSION_COOKIE_NAME } from "../session-cookie.js";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const sessionId: unknown = request.cookies?.[SESSION_COOKIE_NAME];

    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new UnauthorizedException("No hay sesión activa.");
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    // Una sesión de superadministración (ADR-005 §4) no vale como sesión del panel, aunque alguien
    // copie su identificador a esta cookie.
    if (!session || session.scope !== SessionScope.USER || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Sesión inválida o expirada.");
    }

    const requestWithUser = request as RequestWithUser;
    requestWithUser.user = session.user;
    requestWithUser.session = session;

    return true;
  }
}
