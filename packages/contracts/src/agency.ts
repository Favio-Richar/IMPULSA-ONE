import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Modo agencia (F9.3, ADR-028 §2). Los cuerpos de petición viven en `@impulza/validation` (`agency/`).

export const organizationKind = z.enum(["BUSINESS", "AGENCY"]);
export const agencyClientStatus = z.enum(["INVITED", "ACTIVE", "PAUSED", "ARCHIVED", "TRANSFERRING", "ENDED"]);
export const agencyBillingMode = z.enum(["CLIENT_PAYS", "AGENCY_PAYS"]);

/** Un cliente de la agencia, visto por la agencia. Nunca lleva el token de invitación. */
export const agencyClientResponse = z.object({
  id: uuid,
  clientOrganizationId: uuid,
  clientName: z.string(),
  clientSlug: z.string(),
  status: agencyClientStatus,
  billingMode: agencyBillingMode,
  /** true = la agencia creó al cliente; false = vinculó un negocio que ya existía. */
  agencyCreated: z.boolean(),
  /** Correo al que se invitó al propietario (solo en altas nuevas, mientras no acepte). */
  ownerInviteEmail: z.string().nullable(),
  ownerInviteExpiresAt: isoDateTime.nullable(),
  ownerAccepted: z.boolean(),
  /** La agencia puede ver pero no cambiar (cliente en pausa o agencia bloqueada). */
  readOnly: z.boolean(),
  createdAt: isoDateTime,
  acceptedAt: isoDateTime.nullable(),
  pausedAt: isoDateTime.nullable(),
  archivedAt: isoDateTime.nullable(),
});
export type AgencyClientResponse = z.infer<typeof agencyClientResponse>;

/** Estado del modo agencia de una organización: ¿lo puede activar?, ¿cuánto cupo usa? */
export const agencyStatusResponse = z.object({
  kind: organizationKind,
  /** El plan efectivo trae cupo de clientes (distinto de 0). */
  planIncludesAgency: z.boolean(),
  clientsUsed: z.number().int(),
  /** null = sin límite. */
  clientsLimit: z.number().int().nullable(),
  /** Es cliente de otra agencia: una organización no puede ser a la vez cliente y agencia. */
  isClient: z.boolean(),
});
export type AgencyStatusResponse = z.infer<typeof agencyStatusResponse>;

/** La relación con una agencia, vista por el negocio (propietario). `null` si no tiene ninguna abierta. */
export const agencyLinkResponse = z
  .object({
    id: uuid,
    agencyOrganizationId: uuid,
    agencyName: z.string(),
    status: agencyClientStatus,
    agencyCreated: z.boolean(),
    billingMode: agencyBillingMode,
    /** Solicitud pendiente de que el propietario la acepte o la rechace. */
    awaitingOwnerDecision: z.boolean(),
    requestedAt: isoDateTime,
    acceptedAt: isoDateTime.nullable(),
    /** Personas de la agencia con acceso delegado hoy (correo y rol delegado). */
    delegatedMembers: z.array(z.object({ email: z.string(), role: z.string() })),
  })
  .nullable();
export type AgencyLinkResponse = z.infer<typeof agencyLinkResponse>;

export const acceptOwnerInvitationResponse = z.object({
  organizationId: uuid,
  organizationName: z.string(),
});
export type AcceptOwnerInvitationResponse = z.infer<typeof acceptOwnerInvitationResponse>;

/** Cómo llegó el usuario a una organización de su lista: por membresía propia o delegada por una agencia. */
export const organizationAccessResponse = z.object({
  delegated: z.boolean(),
  agencyOrganizationId: uuid.nullable(),
  agencyName: z.string().nullable(),
  /** Solo lectura (cliente en pausa). */
  readOnly: z.boolean(),
});
export type OrganizationAccessResponse = z.infer<typeof organizationAccessResponse>;
