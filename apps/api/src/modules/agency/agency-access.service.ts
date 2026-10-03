import { Inject, Injectable } from "@nestjs/common";
import {
  AgencyClientStatus,
  MembershipSource,
  MembershipStatus,
  type Prisma,
  type PrismaClient,
} from "@impulza/database";
import { AGENCY_DELEGATE_ROLE, AGENCY_DELEGATING_ROLES } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";

type Db = PrismaClient | Prisma.TransactionClient;

const DELEGATING = new Set<string>(AGENCY_DELEGATING_ROLES);

/** Relaciones en las que la agencia trabaja (o puede volver a hacerlo): reciben membresías delegadas. */
export function relationGrantsAccess(relation: { status: AgencyClientStatus; agencyCreated: boolean }): boolean {
  switch (relation.status) {
    case AgencyClientStatus.ACTIVE:
    case AgencyClientStatus.PAUSED:
    case AgencyClientStatus.TRANSFERRING:
      return true;
    case AgencyClientStatus.INVITED:
      return relation.agencyCreated;
    default:
      return false;
  }
}

/**
 * Membresías delegadas (ADR-028 §2): el acceso de una agencia a un cliente **es** una `Membership` en la
 * organización del cliente con `source = AGENCY` y el rol `AGENCY_DELEGATE`. Nace con la relación y muere con
 * ella; nunca es una cuenta de servicio ni una contraseña compartida, y cada acción queda a nombre de la persona.
 *
 * Esta clase solo **sincroniza** esas filas. Quién puede entrar y qué puede hacer lo decide, en cada petición,
 * `OrganizationMembershipGuard` con `delegatedAccessVerdict`: si una sincronización fallara, el guard sigue
 * negando (defensa en profundidad).
 */
@Injectable()
export class AgencyAccessService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Personas de la agencia que reciben acceso delegado: miembros activos con un rol que delega. */
  private async delegatingMembers(db: Db, agencyOrganizationId: string): Promise<string[]> {
    const members = await db.membership.findMany({
      where: {
        organizationId: agencyOrganizationId,
        status: MembershipStatus.ACTIVE,
        source: MembershipSource.DIRECT,
        role: { name: { in: [...DELEGATING] } },
      },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  /**
   * Da acceso delegado a una persona en la organización de un cliente. Una persona que ya es miembro directo
   * activo del cliente conserva su membresía (la directa gana). Devuelve `true` si quedó con acceso delegado.
   */
  private async grantToUser(db: Db, relationId: string, clientOrganizationId: string, userId: string, delegateRoleId: string): Promise<boolean> {
    const existing = await db.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: clientOrganizationId } } });
    const data = {
      status: MembershipStatus.ACTIVE,
      roleId: delegateRoleId,
      source: MembershipSource.AGENCY,
      agencyClientId: relationId,
      acceptedAt: new Date(),
    };
    if (!existing) {
      await db.membership.create({ data: { userId, organizationId: clientOrganizationId, invitedAt: new Date(), ...data } });
      return true;
    }
    if (existing.source === MembershipSource.DIRECT && existing.status !== MembershipStatus.REMOVED) {
      return false; // ya es del equipo del cliente: no se le pisa el rol
    }
    await db.membership.update({ where: { id: existing.id }, data });
    return true;
  }

  /** Da acceso a todas las personas de la agencia que corresponde. Idempotente. */
  async grantForClient(db: Db, relation: { id: string; agencyOrganizationId: string; clientOrganizationId: string }): Promise<number> {
    const delegateRole = await db.role.findUniqueOrThrow({ where: { name: AGENCY_DELEGATE_ROLE } });
    let granted = 0;
    for (const userId of await this.delegatingMembers(db, relation.agencyOrganizationId)) {
      if (await this.grantToUser(db, relation.id, relation.clientOrganizationId, userId, delegateRole.id)) granted += 1;
    }
    return granted;
  }

  /** Quita el acceso delegado de una relación: las membresías pasan a REMOVED (la historia de auditoría se conserva). */
  async revokeForClient(db: Db, relationId: string): Promise<number> {
    const result = await db.membership.updateMany({
      where: { agencyClientId: relationId, source: MembershipSource.AGENCY, status: { not: MembershipStatus.REMOVED } },
      data: { status: MembershipStatus.REMOVED },
    });
    return result.count;
  }

  /**
   * Una persona entró, cambió de rol o salió del equipo de la agencia: se recalcula su acceso a TODOS los
   * clientes de esa agencia. Así sacar a alguien de la agencia le quita el acceso a sus clientes al instante.
   */
  async syncAgencyMember(agencyOrganizationId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: agencyOrganizationId } },
      include: { role: true },
    });
    const eligible = membership !== null && membership.status === MembershipStatus.ACTIVE && membership.source === MembershipSource.DIRECT && DELEGATING.has(membership.role.name);

    const relations = await this.prisma.agencyClient.findMany({
      where: { agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } },
      select: { id: true, clientOrganizationId: true, status: true, agencyCreated: true },
    });
    const delegateRole = await this.prisma.role.findUniqueOrThrow({ where: { name: AGENCY_DELEGATE_ROLE } });

    for (const relation of relations) {
      if (eligible && relationGrantsAccess(relation)) {
        await this.grantToUser(this.prisma, relation.id, relation.clientOrganizationId, userId, delegateRole.id);
      } else {
        await this.prisma.membership.updateMany({
          where: { userId, organizationId: relation.clientOrganizationId, agencyClientId: relation.id, source: MembershipSource.AGENCY, status: { not: MembershipStatus.REMOVED } },
          data: { status: MembershipStatus.REMOVED },
        });
      }
    }
  }
}
