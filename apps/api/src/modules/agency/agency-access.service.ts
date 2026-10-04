import { Inject, Injectable } from "@nestjs/common";
import { grantAgencyAccessForClient, grantAgencyAccessToUser, relationGrantsAccess } from "@impulza/agency";
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

// La regla de qué relaciones dan acceso y cómo se sincronizan las membresías vive en `@impulza/agency`: el worker (importación por CSV)
// da de alta clientes con la misma. Se reexporta acá para no cambiar a quienes ya la importan desde este módulo.
export { relationGrantsAccess };

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

  /** Da acceso a todas las personas de la agencia que corresponde. Idempotente. */
  async grantForClient(db: Db, relation: { id: string; agencyOrganizationId: string; clientOrganizationId: string }): Promise<number> {
    return grantAgencyAccessForClient(db, relation);
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
        await grantAgencyAccessToUser(this.prisma, relation.id, relation.clientOrganizationId, userId, delegateRole.id);
      } else {
        await this.prisma.membership.updateMany({
          where: { userId, organizationId: relation.clientOrganizationId, agencyClientId: relation.id, source: MembershipSource.AGENCY, status: { not: MembershipStatus.REMOVED } },
          data: { status: MembershipStatus.REMOVED },
        });
      }
    }
  }
}
