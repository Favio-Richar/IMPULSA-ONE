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
  /** La agencia ocultó el sitio público de este cliente (pausa/archivo); se muestra de nuevo al reanudar o soltar. */
  publicHidden: z.boolean(),
  /** Modo de facturación que la agencia propuso y el propietario aún no decide (F9.5a). */
  pendingBillingMode: agencyBillingMode.nullable(),
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
    /** La agencia ocultó el sitio público de este negocio; vuelve a verse si reanuda, suelta o el propietario revoca. */
    publicHidden: z.boolean(),
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

// ---- panel de agencia (F9.4) --------------------------------------------------------------------------------------
// Solo cuentan los clientes ACTIVE; nada de la suscripción ni de los pagos del cliente viaja acá (límite duro del ADR-028 §2).

const agencyAlert = z.object({
  code: z.enum(["DOMAIN_FAILED", "DOMAIN_PENDING", "NEAR_PLAN_LIMIT", "SITE_HIDDEN", "NEVER_PUBLISHED"]),
  severity: z.enum(["critical", "warning", "info"]),
  message: z.string(),
});

const agencyRange = z.object({ from: z.string(), to: z.string(), days: z.number().int() });

const agencyPerformance = z.object({
  pageViews: z.number().int(),
  /** Clics en bloques y en WhatsApp. */
  clicks: z.number().int(),
  newContacts: z.number().int(),
  /** Reservas creadas en el período, sin las canceladas. */
  bookings: z.number().int(),
  /** Pedidos creados en el período, sin los cancelados. */
  orders: z.number().int(),
});

export const agencyDashboardResponse = z.object({
  range: agencyRange,
  clients: z.object({
    /** Relaciones abiertas (las terminadas no cuentan). */
    total: z.number().int(),
    byStatus: z.object({
      INVITED: z.number().int(),
      ACTIVE: z.number().int(),
      PAUSED: z.number().int(),
      ARCHIVED: z.number().int(),
      TRANSFERRING: z.number().int(),
      ENDED: z.number().int(),
    }),
  }),
  /** Qué paga quién entre las relaciones abiertas: los que paga la agencia y los que paga cada negocio. */
  billing: z.object({ agencyPays: z.number().int(), clientPays: z.number().int(), pendingChanges: z.number().int() }),
  /** Suma de los clientes ACTIVE. */
  totals: agencyPerformance,
  alerts: z.object({
    clientsWithAlerts: z.number().int(),
    domainsFailed: z.number().int(),
    domainsPending: z.number().int(),
    clientsNearPlanLimit: z.number().int(),
  }),
});
export type AgencyDashboardResponse = z.infer<typeof agencyDashboardResponse>;

export const agencyOverviewItem = z.object({
  id: uuid,
  clientOrganizationId: uuid,
  clientName: z.string(),
  clientSlug: z.string(),
  status: agencyClientStatus,
  billingMode: agencyBillingMode,
  agencyCreated: z.boolean(),
  /** Correo al que se invitó al propietario (solo en altas nuevas, mientras no acepte). */
  ownerInviteEmail: z.string().nullable(),
  readOnly: z.boolean(),
  publicHidden: z.boolean(),
  pendingBillingMode: agencyBillingMode.nullable(),
  /** `null` si el cliente no está ACTIVE: no suma ni se mide. */
  performance: agencyPerformance.nullable(),
  plan: z
    .object({
      code: z.string(),
      name: z.string(),
      usage: z.array(z.object({ key: z.enum(["sites", "contacts"]), label: z.string(), used: z.number().int(), limit: z.number().int().nullable() })),
    })
    .nullable(),
  domains: z.object({ verified: z.number().int(), pending: z.number().int(), failed: z.number().int() }).nullable(),
  lastPublishedAt: isoDateTime.nullable(),
  alerts: z.array(agencyAlert),
});
export type AgencyOverviewItem = z.infer<typeof agencyOverviewItem>;

export const agencyOverviewResponse = z.object({
  range: agencyRange,
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Relaciones que cumplen la búsqueda y el filtro (no solo las de esta página). */
  total: z.number().int(),
  items: z.array(agencyOverviewItem),
});
export type AgencyOverviewResponse = z.infer<typeof agencyOverviewResponse>;

// ---- quién paga el plan (F9.5a) ---------------------------------------------------------------------------------------
// Nada de la suscripción ni de los medios de pago del cliente viaja acá: solo el modo, la propuesta y el historial.

export const agencyBillingChangeStatus = z.enum(["PENDING", "CONFIRMED", "REJECTED", "CANCELED"]);

export const agencyBillingChange = z.object({
  id: uuid,
  fromMode: agencyBillingMode,
  toMode: agencyBillingMode,
  status: agencyBillingChangeStatus,
  /** Quién lo pidió: la agencia o el propietario del negocio. */
  requestedBy: z.enum(["AGENCY", "OWNER"]),
  /** Correo de quien lo pidió (puede faltar si esa persona ya no existe). */
  requestedByEmail: z.string().nullable(),
  createdAt: isoDateTime,
  decidedAt: isoDateTime.nullable(),
});
export type AgencyBillingChange = z.infer<typeof agencyBillingChange>;

/** El modo vigente, la propuesta pendiente (si hay) y el historial, de más reciente a más antiguo. */
export const agencyBillingResponse = z.object({
  billingMode: agencyBillingMode,
  pending: agencyBillingChange.nullable(),
  history: z.array(agencyBillingChange),
});
export type AgencyBillingResponse = z.infer<typeof agencyBillingResponse>;
