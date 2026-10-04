import { AgencyClientStatus, OrganizationKind, type AgencyBillingMode, type AgencyClient, type Organization, type Prisma } from "@impulza/database";
import { grantAgencyAccessForClient } from "./access.js";

export interface NewAgencyClient {
  agencyOrganizationId: string;
  /** Quien lo pide (la persona de la agencia); `null` si esa persona ya no existe. */
  actorId: string | null;
  name: string;
  slug: string;
  /** A esta persona se le invita a ser la propietaria del negocio. */
  ownerEmail: string;
  billingMode: AgencyBillingMode;
  /** Huella del token de la invitación (nunca el token). */
  inviteTokenHash: string;
  inviteExpiresAt: Date;
}

/**
 * El alta de un cliente que crea la agencia (ADR-028 §2): su organización nueva, la relación `INVITED` con `agency_created` y el acceso
 * delegado de la agencia desde el primer día. Corre dentro de la transacción de quien la llama (que además verifica el cupo del plan):
 * la usan la API («Nuevo cliente», «Duplicar») y el worker (importación por CSV), así el alta es la misma en los tres.
 */
export async function createAgencyClientRecords(tx: Prisma.TransactionClient, input: NewAgencyClient): Promise<{ organization: Organization; relation: AgencyClient }> {
  const organization = await tx.organization.create({ data: { name: input.name, slug: input.slug, kind: OrganizationKind.BUSINESS } });
  const relation = await tx.agencyClient.create({
    data: {
      agencyOrganizationId: input.agencyOrganizationId,
      clientOrganizationId: organization.id,
      status: AgencyClientStatus.INVITED,
      billingMode: input.billingMode,
      agencyCreated: true,
      requestedById: input.actorId,
      ownerInviteEmail: input.ownerEmail,
      ownerInviteTokenHash: input.inviteTokenHash,
      ownerInviteExpiresAt: input.inviteExpiresAt,
    },
  });
  await grantAgencyAccessForClient(tx, relation);
  return { organization, relation };
}
