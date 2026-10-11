import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AgencyClientStatus,
  MembershipSource,
  MembershipStatus,
  OrganizationKind,
  type Organization,
  type PrismaClient,
  type User,
} from "@impulza/database";
import type { MyOrganizationResponse } from "@impulza/contracts";
import { delegatedAccessVerdict, memberChangeVerdict, missingPermissions } from "@impulza/validation";
import type { EmailAdapter } from "@impulza/auth";
import { loadMemberScope } from "@impulza/agency";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import type { AssignableRole } from "./assignable-roles.js";
import type { MembershipWithRole } from "./request-with-membership.js";
import { PlansService } from "../plans/plans.service.js";
import { AgencyAccessService } from "../agency/agency-access.service.js";
import { permissionsOfMembership, permissionsOfSystemRole } from "./team-permissions.js";

/** Un rol del sistema o uno personalizado (F9.6a): exactamente uno. */
export interface RoleChoice {
  role?: AssignableRole | undefined;
  customRoleId?: string | undefined;
}

function toOrganizationResponse(organization: Organization): Omit<MyOrganizationResponse, "access"> {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    planId: organization.planId,
    status: organization.status,
    kind: organization.kind,
    blockedAt: organization.blockedAt?.toISOString() ?? null,
    blockedReason: organization.blockedReason,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: EmailAdapter,
    private readonly auditService: AuditService,
    private readonly plansService: PlansService,
    private readonly agencyAccess: AgencyAccessService,
  ) {}

  async createOrganization(owner: User, name: string, slug: string): Promise<Organization> {
    const ownerRole = await this.prisma.role.findUniqueOrThrow({ where: { name: "OWNER" } });

    const existingSlug = await this.prisma.organization.findUnique({ where: { slug } });
    if (existingSlug) {
      throw new ConflictException("Ese slug ya está en uso.");
    }

    const organization = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { name, slug } });

      await tx.membership.create({
        data: {
          userId: owner.id,
          organizationId: created.id,
          roleId: ownerRole.id,
          status: MembershipStatus.ACTIVE,
          acceptedAt: new Date(),
        },
      });

      return created;
    });

    await this.auditService.record({
      organizationId: organization.id,
      actorId: owner.id,
      action: "organization.created",
      targetType: "Organization",
      targetId: organization.id,
    });

    return organization;
  }

  /**
   * Mis organizaciones, con cómo llegué a cada una (F9.3): propia, o delegada por una agencia (con su nombre y si
   * está en solo lectura). Una delegada que el guard negaría (archivada, sin aceptar) no se ofrece.
   */
  async listMyOrganizations(userId: string): Promise<MyOrganizationResponse[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      include: { organization: true, role: { select: { name: true } }, agencyClient: { include: { agencyOrganization: { select: { id: true, name: true } } } } },
      orderBy: { acceptedAt: "asc" },
    });

    const result: MyOrganizationResponse[] = [];
    for (const membership of memberships) {
      const relation = membership.agencyClient;
      if (membership.source === MembershipSource.AGENCY) {
        if (!relation) continue;
        const read = delegatedAccessVerdict({ status: relation.status, agencyCreated: relation.agencyCreated, method: "GET", path: "/organizations/x" });
        if (!read.allowed) continue;
      }
      result.push({
        ...toOrganizationResponse(membership.organization),
        access:
          membership.source === MembershipSource.AGENCY && relation
            ? {
                delegated: true,
                agencyOrganizationId: relation.agencyOrganization.id,
                agencyName: relation.agencyOrganization.name,
                readOnly: relation.status === AgencyClientStatus.PAUSED,
                modules: [...(await loadMemberScope(this.prisma, relation.agencyOrganization.id, userId)).modules],
                clientViewer: false,
              }
            : { delegated: false, agencyOrganizationId: null, agencyName: null, readOnly: false, modules: [], clientViewer: membership.role.name === "CLIENT_VIEWER" },
      });
    }
    return result;
  }

  async getOrganization(organizationId: string): Promise<Organization> {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  }

  async listMembers(organizationId: string): Promise<
    Array<{ membershipId: string; userId: string; email: string; role: string; status: MembershipStatus; source: MembershipSource; customRoleId: string | null }>
  > {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, status: { not: MembershipStatus.REMOVED } },
      include: { user: true, role: true, customRole: { select: { name: true } } },
      orderBy: { invitedAt: "asc" },
    });

    return memberships.map((membership) => ({
      membershipId: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      role: membership.customRole?.name ?? membership.role.name,
      status: membership.status,
      source: membership.source,
      customRoleId: membership.customRoleId,
    }));
  }

  private async actorMembership(organizationId: string, actorId: string) {
    return this.prisma.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId: actorId, organizationId } }, include: { role: true } });
  }

  /**
   * Resuelve lo que se va a asignar. Un rol personalizado se guarda con el rol ANALYST de piso (solo lectura) y su `customRoleId`; uno
   * de otra organización responde como si no existiera.
   */
  private async resolveRoleChoice(db: Pick<PrismaClient, "role" | "customRole" | "rolePermission" | "customRolePermission">, organizationId: string, choice: RoleChoice) {
    if (choice.customRoleId !== undefined) {
      const custom = await db.customRole.findFirst({ where: { id: choice.customRoleId, organizationId } });
      if (!custom) throw new NotFoundException("El rol no existe en esta organización.");
      const floor = await db.role.findUniqueOrThrow({ where: { name: "ANALYST" } });
      const permissions = await permissionsOfMembership(db as PrismaClient, { roleId: floor.id, customRoleId: custom.id });
      return { roleId: floor.id, customRoleId: custom.id as string | null, label: custom.name, permissions };
    }
    const role = await db.role.findUniqueOrThrow({ where: { name: choice.role as AssignableRole } });
    return { roleId: role.id, customRoleId: null as string | null, label: role.name, permissions: await permissionsOfSystemRole(db as PrismaClient, role.id) };
  }

  async inviteMember(
    organizationId: string,
    actorId: string,
    email: string,
    choice: RoleChoice,
  ): Promise<{ membershipId: string }> {
    const role = await this.resolveRoleChoice(this.prisma, organizationId, choice);
    const roleName = role.label;
    // Nadie invita con un rol que tenga permisos que no tiene (F9.6a).
    const actor = await this.actorMembership(organizationId, actorId);
    const missing = missingPermissions(await permissionsOfMembership(this.prisma, actor), role.permissions);
    if (missing.length > 0) {
      throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: "ESCALATION", message: "No puedes dar permisos que tú no tienes.", missing });
    }

    const invitee = await this.prisma.user.findUnique({ where: { email } });
    if (!invitee) {
      // A diferencia de login/forgot-password, aquí sí se puede confirmar: quien invita ya
      // demostró pertenecer a la organización, no es un tercero sondeando cuentas ajenas.
      throw new NotFoundException("No existe una cuenta registrada con ese correo todavía.");
    }

    const existingMembership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: invitee.id, organizationId } },
    });
    if (existingMembership && existingMembership.status !== MembershipStatus.REMOVED) {
      throw new ConflictException("Esa persona ya es miembro o tiene una invitación pendiente.");
    }

    // Una invitación pendiente ya ocupa un lugar del plan (F4.2): por eso se verifica al invitar y
    // no al aceptar.
    const membership = await this.prisma.$transaction(async (tx) => {
      await this.plansService.assertWithinLimit(tx, organizationId, "members");
      return existingMembership
        ? tx.membership.update({
            where: { id: existingMembership.id },
            data: { status: MembershipStatus.INVITED, roleId: role.roleId, customRoleId: role.customRoleId, invitedAt: new Date(), acceptedAt: null, source: MembershipSource.DIRECT, agencyClientId: null },
          })
        : tx.membership.create({
            data: { userId: invitee.id, organizationId, roleId: role.roleId, customRoleId: role.customRoleId, status: MembershipStatus.INVITED },
          });
    });

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    await this.emailAdapter.send({
      to: invitee.email,
      subject: `Invitación a ${organization.name} — Impulza One`,
      text: `Te invitaron a unirte a "${organization.name}" con el rol ${roleName}. Entra a ${env.APP_BASE_URL}/invitaciones para aceptar.`,
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "membership.invited",
      targetType: "Membership",
      targetId: membership.id,
      metadata: { email: invitee.email, role: roleName, customRoleId: role.customRoleId },
    });

    return { membershipId: membership.id };
  }

  async acceptInvitation(userId: string, membershipId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({ where: { id: membershipId } });

    if (!membership || membership.userId !== userId) {
      throw new NotFoundException("La invitación no existe o no te pertenece.");
    }
    if (membership.status !== MembershipStatus.INVITED) {
      throw new ConflictException("Esta invitación ya no está pendiente.");
    }

    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { status: MembershipStatus.ACTIVE, acceptedAt: new Date() },
    });
    await this.syncIfAgency(membership.organizationId, userId);
  }

  /** Si la organización es una agencia, el acceso de esa persona a los clientes se recalcula al instante (F9.3). */
  private async syncIfAgency(organizationId: string, userId: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { kind: true } });
    if (organization?.kind === OrganizationKind.AGENCY) {
      await this.agencyAccess.syncAgencyMember(organizationId, userId);
    }
  }

  /** El acceso de alguien que viene de una agencia lo gestiona la relación con la agencia, no el equipo del negocio. */
  private assertNotDelegated(target: MembershipWithRole): void {
    if (target.source === MembershipSource.AGENCY) {
      throw new ConflictException("Esta persona tiene acceso a través de una agencia: su acceso se gestiona en Configuración › Agencia.");
    }
  }

  async changeRole(
    organizationId: string,
    actorId: string,
    targetMembershipId: string,
    choice: RoleChoice,
  ): Promise<void> {
    const target = await this.getOrgMembershipOrThrow(organizationId, targetMembershipId);
    if (target.role.name === "OWNER") {
      throw new ForbiddenException("El rol de OWNER no se cambia por esta vía.");
    }
    this.assertNotDelegated(target);

    const role = await this.resolveRoleChoice(this.prisma, organizationId, choice);
    await this.assertMemberChange(organizationId, actorId, target, role.permissions);
    await this.prisma.membership.update({ where: { id: target.id }, data: { roleId: role.roleId, customRoleId: role.customRoleId } });
    await this.syncIfAgency(organizationId, target.userId);

    await this.auditService.record({
      organizationId,
      actorId,
      action: "membership.role_changed",
      targetType: "Membership",
      targetId: target.id,
      metadata: { previousRole: target.customRoleId ? `custom:${target.customRoleId}` : target.role.name, newRole: role.label, customRoleId: role.customRoleId },
    });
  }

  async removeMember(organizationId: string, actorId: string, targetMembershipId: string): Promise<void> {
    const target = await this.getOrgMembershipOrThrow(organizationId, targetMembershipId);
    if (target.role.name === "OWNER") {
      throw new ForbiddenException("No se puede remover al OWNER de la organización.");
    }
    this.assertNotDelegated(target);
    // Irse uno mismo del equipo no es escalar nada; quitar a otra persona sí pasa por las reglas.
    if (target.userId !== actorId) await this.assertMemberChange(organizationId, actorId, target, []);

    await this.prisma.membership.update({
      where: { id: target.id },
      data: { status: MembershipStatus.REMOVED },
    });
    await this.syncIfAgency(organizationId, target.userId);

    await this.auditService.record({
      organizationId,
      actorId,
      action: "membership.removed",
      targetType: "Membership",
      targetId: target.id,
      metadata: { role: target.role.name },
    });
  }

  /** Las reglas contra la escalada de privilegios (F9.6a), en un solo sitio para cambiar roles y quitar gente. */
  private async assertMemberChange(organizationId: string, actorId: string, target: MembershipWithRole, granted: string[]): Promise<void> {
    const actor = await this.actorMembership(organizationId, actorId);
    const verdict = memberChangeVerdict({
      actorMembershipId: actor.id,
      targetMembershipId: target.id,
      targetRoleName: target.role.name,
      actorPermissions: await permissionsOfMembership(this.prisma, actor),
      targetPermissions: await permissionsOfMembership(this.prisma, target),
      granted,
    });
    if (!verdict.allowed) {
      throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: verdict.code, message: verdict.message, ...(verdict.missing ? { missing: verdict.missing } : {}) });
    }
  }

  private async getOrgMembershipOrThrow(
    organizationId: string,
    membershipId: string,
  ): Promise<MembershipWithRole> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: { role: true },
    });

    if (!membership || membership.organizationId !== organizationId) {
      throw new NotFoundException("La membresía no existe en esta organización.");
    }

    return membership;
  }
}
