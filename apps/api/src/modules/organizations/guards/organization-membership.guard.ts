import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { MembershipStatus, OrganizationStatus, type PrismaClient } from "@impulza/database";
import type { Request } from "express";
import { PRISMA } from "../../../database/prisma.module.js";
import type { RequestWithMembership } from "../request-with-membership.js";

// Aplica el principio central de ADR-002: el organization_id nunca se confía "porque viene en la
// URL" — se resuelve la membresía real del usuario autenticado y se verifica que esté ACTIVA.
// Debe usarse siempre después de SessionAuthGuard (necesita req.user ya resuelto).
//
// También aplica el bloqueo de superadministración (ADR-005 §6): una organización bloqueada se
// puede leer (y exportar sus datos, ADR-004) pero no modificar. Vive acá porque este guard ya está
// en **todas** las rutas de organización — un chequeo por controlador se olvidaría en alguno.
export const ORGANIZATION_BLOCKED = "ORGANIZATION_BLOCKED";
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
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
      include: { role: true, organization: { select: { status: true } } },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      // Mismo mensaje exista o no la organización/membresía — no revelar si una organización
      // ajena existe a alguien que no pertenece a ella.
      throw new ForbiddenException("No tienes acceso a esta organización.");
    }

    if (
      membership.organization.status === OrganizationStatus.BLOCKED &&
      !READ_ONLY_METHODS.has(request.method.toUpperCase())
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: ORGANIZATION_BLOCKED,
        message: "Esta organización está bloqueada: puedes ver y exportar tus datos, pero no hacer cambios. Contacta a soporte.",
      });
    }

    requestWithUser.membership = membership;

    return true;
  }
}
