import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { delegatingMemberIds, loadAgencyScopes, loadMemberScope } from "@impulza/agency";
import { AgencyClientStatus, MembershipSource, MembershipStatus, type PrismaClient } from "@impulza/database";
import type { AgencyMemberScopeResponse, AgencyTeamResponse } from "@impulza/contracts";
import { FULL_SCOPE, scopeChangeVerdict, type AgencyScope, type AgencyScopeDto } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { AgencyAccessService } from "./agency-access.service.js";
import { AgencyService } from "./agency.service.js";

const toResponse = (scope: AgencyScope): AgencyMemberScopeResponse => ({ allClients: scope.allClients, clientIds: [...scope.clientIds].sort(), modules: [...scope.modules].sort() });

/**
 * Acceso del equipo de una agencia por cliente y por módulo (F9.6b, ADR-028 §3). Acotar a alguien cambia dos cosas: qué membresías
 * delegadas tiene (se resincronizan al instante) y qué deja pasar la puerta de entrada en cada petición. Reglas: nadie cambia su propio
 * acceso, el propietario de la agencia no se acota y nadie da más alcance del que tiene.
 */
@Injectable()
export class AgencyTeamService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly agencyService: AgencyService,
    private readonly access: AgencyAccessService,
    private readonly audit: AuditService,
  ) {}

  async list(agencyOrganizationId: string, actorUserId: string): Promise<AgencyTeamResponse> {
    await this.agencyService.assertAgency(agencyOrganizationId);
    const [userIds, scopes, clients, actorScope] = await Promise.all([
      delegatingMemberIds(this.prisma, agencyOrganizationId),
      loadAgencyScopes(this.prisma, agencyOrganizationId),
      this.prisma.agencyClient.findMany({
        where: { agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } },
        select: { id: true, clientOrganization: { select: { name: true, slug: true } } },
        orderBy: { clientOrganization: { name: "asc" } },
      }),
      loadMemberScope(this.prisma, agencyOrganizationId, actorUserId),
    ]);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId: agencyOrganizationId, userId: { in: userIds }, status: MembershipStatus.ACTIVE, source: MembershipSource.DIRECT },
      include: { user: { select: { email: true } }, role: { select: { name: true } } },
      orderBy: { invitedAt: "asc" },
    });
    return {
      members: memberships.map((membership) => ({
        userId: membership.userId,
        email: membership.user.email,
        role: membership.role.name,
        scope: toResponse(scopes.get(membership.userId) ?? FULL_SCOPE),
        isSelf: membership.userId === actorUserId,
      })),
      clients: clients.map((client) => ({ id: client.id, name: client.clientOrganization.name, slug: client.clientOrganization.slug })),
      actorScope: toResponse(actorScope),
    };
  }

  async setScope(agencyOrganizationId: string, actorUserId: string, targetUserId: string, dto: AgencyScopeDto): Promise<AgencyMemberScopeResponse> {
    await this.agencyService.assertAgency(agencyOrganizationId);

    // La persona debe ser del equipo de la agencia y de las que delegan: acotar a alguien que no delega no tendría efecto y sería un engaño.
    const target = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: agencyOrganizationId } },
      include: { role: { select: { name: true } } },
    });
    if (!target || target.status !== MembershipStatus.ACTIVE || target.source !== MembershipSource.DIRECT || !(await delegatingMemberIds(this.prisma, agencyOrganizationId)).includes(targetUserId)) {
      throw new NotFoundException("Esa persona no es del equipo de la agencia o su rol no da acceso a clientes.");
    }

    // Los clientes elegidos deben ser de ESTA agencia (aislamiento, ADR-002): un id ajeno responde como si no existiera.
    if (!dto.allClients) {
      const valid = await this.prisma.agencyClient.count({ where: { id: { in: dto.clientIds }, agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } } });
      if (valid !== dto.clientIds.length) throw new NotFoundException("Alguno de los clientes elegidos no existe en tu agencia.");
    }

    const actorScope = await loadMemberScope(this.prisma, agencyOrganizationId, actorUserId);
    const verdict = scopeChangeVerdict({ actorUserId, targetUserId, targetRoleName: target.role.name, actorScope, granted: dto });
    if (!verdict.allowed) {
      throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: verdict.code, message: verdict.message });
    }

    const previous = await loadMemberScope(this.prisma, agencyOrganizationId, targetUserId);
    const unrestricted = dto.allClients && dto.modules.length === 0;
    await this.prisma.$transaction(async (tx) => {
      if (unrestricted) {
        // Volver a «todo» borra la fila: es el estado por defecto, no una excepción que mantener.
        await tx.agencyMemberScope.deleteMany({ where: { agencyOrganizationId, userId: targetUserId } });
        return;
      }
      const scope = await tx.agencyMemberScope.upsert({
        where: { agencyOrganizationId_userId: { agencyOrganizationId, userId: targetUserId } },
        create: { agencyOrganizationId, userId: targetUserId, allClients: dto.allClients, modules: dto.modules, updatedById: actorUserId },
        update: { allClients: dto.allClients, modules: dto.modules, updatedById: actorUserId },
      });
      await tx.agencyMemberScopeClient.deleteMany({ where: { scopeId: scope.id } });
      if (!dto.allClients) {
        await tx.agencyMemberScopeClient.createMany({ data: dto.clientIds.map((agencyClientId) => ({ scopeId: scope.id, agencyClientId })) });
      }
    });

    // Las membresías delegadas se recalculan ya: los clientes que quedaron fuera pierden el acceso y los que entraron lo ganan.
    await this.access.syncAgencyMember(agencyOrganizationId, targetUserId);

    await this.audit.record({
      organizationId: agencyOrganizationId,
      actorId: actorUserId,
      action: "agency.member_scope_changed",
      targetType: "User",
      targetId: targetUserId,
      metadata: { previous: toResponse(previous), next: toResponse(unrestricted ? FULL_SCOPE : dto) },
    });
    return toResponse(unrestricted ? FULL_SCOPE : dto);
  }
}
