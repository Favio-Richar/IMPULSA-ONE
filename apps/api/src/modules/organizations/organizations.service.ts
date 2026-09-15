import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  MembershipStatus,
  type Organization,
  type PrismaClient,
  type User,
} from "@impulza/database";
import type { EmailAdapter } from "@impulza/auth";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import type { AssignableRole } from "./assignable-roles.js";
import type { MembershipWithRole } from "./request-with-membership.js";

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly emailAdapter: EmailAdapter,
  ) {}

  async createOrganization(owner: User, name: string, slug: string): Promise<Organization> {
    const ownerRole = await this.prisma.role.findUniqueOrThrow({ where: { name: "OWNER" } });

    const existingSlug = await this.prisma.organization.findUnique({ where: { slug } });
    if (existingSlug) {
      throw new ConflictException("Ese slug ya está en uso.");
    }

    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name, slug } });

      await tx.membership.create({
        data: {
          userId: owner.id,
          organizationId: organization.id,
          roleId: ownerRole.id,
          status: MembershipStatus.ACTIVE,
          acceptedAt: new Date(),
        },
      });

      return organization;
    });
  }

  async listMyOrganizations(userId: string): Promise<Organization[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      include: { organization: true },
      orderBy: { acceptedAt: "asc" },
    });

    return memberships.map((membership) => membership.organization);
  }

  async getOrganization(organizationId: string): Promise<Organization> {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  }

  async listMembers(organizationId: string): Promise<
    Array<{ membershipId: string; userId: string; email: string; role: string; status: MembershipStatus }>
  > {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, status: { not: MembershipStatus.REMOVED } },
      include: { user: true, role: true },
      orderBy: { invitedAt: "asc" },
    });

    return memberships.map((membership) => ({
      membershipId: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      role: membership.role.name,
      status: membership.status,
    }));
  }

  async inviteMember(
    organizationId: string,
    email: string,
    roleName: AssignableRole,
  ): Promise<{ membershipId: string }> {
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

    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: roleName } });

    const membership = existingMembership
      ? await this.prisma.membership.update({
          where: { id: existingMembership.id },
          data: { status: MembershipStatus.INVITED, roleId: role.id, invitedAt: new Date(), acceptedAt: null },
        })
      : await this.prisma.membership.create({
          data: { userId: invitee.id, organizationId, roleId: role.id, status: MembershipStatus.INVITED },
        });

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });

    await this.emailAdapter.send({
      to: invitee.email,
      subject: `Invitación a ${organization.name} — Impulza One`,
      text: `Te invitaron a unirte a "${organization.name}" con el rol ${roleName}. Entra a ${env.APP_BASE_URL}/invitaciones para aceptar.`,
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
  }

  async changeRole(
    organizationId: string,
    targetMembershipId: string,
    roleName: AssignableRole,
  ): Promise<void> {
    const target = await this.getOrgMembershipOrThrow(organizationId, targetMembershipId);
    if (target.role.name === "OWNER") {
      throw new ForbiddenException("El rol de OWNER no se cambia por esta vía.");
    }

    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await this.prisma.membership.update({ where: { id: target.id }, data: { roleId: role.id } });
  }

  async removeMember(organizationId: string, targetMembershipId: string): Promise<void> {
    const target = await this.getOrgMembershipOrThrow(organizationId, targetMembershipId);
    if (target.role.name === "OWNER") {
      throw new ForbiddenException("No se puede remover al OWNER de la organización.");
    }

    await this.prisma.membership.update({
      where: { id: target.id },
      data: { status: MembershipStatus.REMOVED },
    });
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
