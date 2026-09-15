import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { MembershipStatus, type PrismaClient } from "@impulza/database";
import type { Request } from "express";
import { PRISMA } from "../../../database/prisma.module.js";
import type { RequestWithMembership } from "../request-with-membership.js";

// Aplica el principio central de ADR-002: el organization_id nunca se confía "porque viene en la
// URL" — se resuelve la membresía real del usuario autenticado y se verifica que esté ACTIVA.
// Debe usarse siempre después de SessionAuthGuard (necesita req.user ya resuelto).
@Injectable()
export class OrganizationMembershipGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const organizationId = request.params.organizationId;

    if (typeof organizationId !== "string" || organizationId.length === 0) {
      throw new ForbiddenException("Falta el identificador de la organización.");
    }

    const requestWithUser = request as RequestWithMembership;
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: requestWithUser.user.id,
          organizationId,
        },
      },
      include: { role: true },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      // Mismo mensaje exista o no la organización/membresía — no revelar si una organización
      // ajena existe a alguien que no pertenece a ella.
      throw new ForbiddenException("No tienes acceso a esta organización.");
    }

    requestWithUser.membership = membership;

    return true;
  }
}
