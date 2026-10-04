import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { MembershipSource, MembershipStatus, OrganizationStatus, type PrismaClient } from "@impulza/database";
import { loadMemberScope } from "@impulza/agency";
import { AGENCY_DELEGATING_ROLES, agencyModuleOfSegments, delegatedAccessVerdict, scopeAllowsClient, scopeAllowsModule, segmentsAfterOrganization } from "@impulza/validation";
import type { Request } from "express";
import { Reflector } from "@nestjs/core";
import { PRISMA } from "../../../database/prisma.module.js";
import { ALLOW_WHEN_BLOCKED_KEY } from "../allow-when-blocked.decorator.js";
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
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    // @Inject explícito: ver el mismo comentario en apps/api/src/common/rate-limit.guard.ts.
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

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
      include: {
        role: true,
        organization: { select: { status: true } },
        // Solo trae algo si la membresía es delegada por una agencia (F9.3).
        agencyClient: { include: { agencyOrganization: { select: { status: true } } } },
      },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      // Mismo mensaje exista o no la organización/membresía — no revelar si una organización
      // ajena existe a alguien que no pertenece a ella.
      throw new ForbiddenException("No tienes acceso a esta organización.");
    }

    if (
      membership.organization.status === OrganizationStatus.BLOCKED &&
      !READ_ONLY_METHODS.has(request.method.toUpperCase()) &&
      !this.reflector.get<boolean | undefined>(ALLOW_WHEN_BLOCKED_KEY, context.getHandler())
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: ORGANIZATION_BLOCKED,
        message: "Esta organización está bloqueada: puedes ver y exportar tus datos, pero no hacer cambios. Contacta a soporte.",
      });
    }

    if (membership.source === MembershipSource.AGENCY) {
      await this.assertDelegatedAccess(membership, organizationId, request);
    }

    requestWithUser.membership = membership;

    return true;
  }

  /**
   * Acceso DELEGADO de una agencia (F9.3, ADR-028 §2) — el único lugar donde se decide, para todas las rutas de
   * organización, qué puede hacer una persona que entra a un cliente a través de su agencia. La regla en sí
   * (`delegatedAccessVerdict`) es una función pura probada aparte; acá se aplica en cada petición, así que revocar,
   * pausar o archivar surte efecto en la siguiente, sin sesiones que invalidar.
   */
  private async assertDelegatedAccess(
    membership: {
      userId: string;
      agencyClient: {
        id: string;
        clientOrganizationId: string;
        agencyOrganizationId: string;
        status: Parameters<typeof delegatedAccessVerdict>[0]["status"];
        agencyCreated: boolean;
        agencyOrganization: { status: OrganizationStatus };
      } | null;
    },
    organizationId: string,
    request: Request,
  ): Promise<void> {
    const deny = (code: string, message: string): never => {
      throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code, message });
    };

    const relation = membership.agencyClient;
    if (!relation || relation.clientOrganizationId !== organizationId) {
      return deny("AGENCY_ACCESS_REVOKED", "La agencia ya no tiene acceso a este negocio.");
    }

    const verdict = delegatedAccessVerdict({
      status: relation.status,
      agencyCreated: relation.agencyCreated,
      method: request.method,
      path: request.originalUrl,
    });
    if (!verdict.allowed) {
      return deny(verdict.code, verdict.message);
    }

    // Una agencia bloqueada por superadministración también queda en solo lectura frente a sus clientes.
    if (relation.agencyOrganization.status === OrganizationStatus.BLOCKED && !READ_ONLY_METHODS.has(request.method.toUpperCase())) {
      return deny(ORGANIZATION_BLOCKED, "Tu agencia está bloqueada: puedes ver pero no hacer cambios en este cliente.");
    }

    // Defensa en profundidad: aunque la sincronización de membresías fallara, la persona debe seguir siendo un miembro
    // activo de la agencia con un rol que delega. Sacar a alguien de la agencia le quita el acceso a sus clientes.
    const agencyMembership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: membership.userId, organizationId: relation.agencyOrganizationId } },
      include: { role: true },
    });
    if (
      !agencyMembership ||
      agencyMembership.status !== MembershipStatus.ACTIVE ||
      agencyMembership.source !== MembershipSource.DIRECT ||
      !(AGENCY_DELEGATING_ROLES as readonly string[]).includes(agencyMembership.role.name)
    ) {
      deny("AGENCY_ACCESS_REVOKED", "Ya no formas parte de la agencia que tiene acceso a este negocio.");
    }

    // F9.6b: el alcance de la persona dentro de la agencia (por cliente y por módulo). Se lee en cada petición, así que acotar a alguien
    // surte efecto en la siguiente; que además se quite su membresía en los clientes excluidos es solo la primera barrera.
    const scope = await loadMemberScope(this.prisma, relation.agencyOrganizationId, membership.userId);
    if (!scopeAllowsClient(scope, relation.id)) {
      deny("AGENCY_SCOPE_DENIED", "Tu agencia no te dio acceso a este cliente.");
    }
    if (!scopeAllowsModule(scope, agencyModuleOfSegments(segmentsAfterOrganization(request.originalUrl)))) {
      deny("AGENCY_MODULE_DENIED", "Tu agencia no te dio acceso a esta sección de este cliente.");
    }
  }
}
