import { AgencyClientStatus, MembershipSource, MembershipStatus, type Prisma, type PrismaClient } from "@impulza/database";
import { AGENCY_DELEGATE_ROLE, AGENCY_DELEGATING_ROLES } from "@impulza/validation";

type Db = PrismaClient | Prisma.TransactionClient;

const DELEGATING = [...AGENCY_DELEGATING_ROLES] as string[];

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

/** Personas de la agencia que reciben acceso delegado: miembros activos con un rol que delega. */
export async function delegatingMemberIds(db: Db, agencyOrganizationId: string): Promise<string[]> {
  const members = await db.membership.findMany({
    where: {
      organizationId: agencyOrganizationId,
      status: MembershipStatus.ACTIVE,
      source: MembershipSource.DIRECT,
      role: { name: { in: DELEGATING } },
    },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

/**
 * Da acceso delegado a una persona en la organización de un cliente (ADR-028 §2): el acceso de una agencia **es** una `Membership` con
 * `source = AGENCY` y el rol `AGENCY_DELEGATE`. Una persona que ya es miembro directo activo del cliente conserva su membresía (la directa
 * gana). Devuelve `true` si quedó con acceso delegado.
 *
 * Vive en este paquete —y no solo en la API— porque el alta de clientes también la hace el worker (importación por CSV): una sola regla.
 */
export async function grantAgencyAccessToUser(db: Db, relationId: string, clientOrganizationId: string, userId: string, delegateRoleId: string): Promise<boolean> {
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
export async function grantAgencyAccessForClient(db: Db, relation: { id: string; agencyOrganizationId: string; clientOrganizationId: string }): Promise<number> {
  const delegateRole = await db.role.findUniqueOrThrow({ where: { name: AGENCY_DELEGATE_ROLE } });
  let granted = 0;
  for (const userId of await delegatingMemberIds(db, relation.agencyOrganizationId)) {
    if (await grantAgencyAccessToUser(db, relation.id, relation.clientOrganizationId, userId, delegateRole.id)) granted += 1;
  }
  return granted;
}
