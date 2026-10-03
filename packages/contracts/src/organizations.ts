import { z } from "zod";
import { organizationAccessResponse, organizationKind } from "./agency.js";
import { isoDateTime, uuid } from "./primitives.js";

export const membershipStatus = z.enum(["INVITED", "ACTIVE", "SUSPENDED", "REMOVED"]);

/** ADR-005 §6: una organización bloqueada por superadministración queda en solo lectura. */
export const organizationStatus = z.enum(["ACTIVE", "BLOCKED"]);

export const organizationResponse = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  planId: uuid.nullable(),
  status: organizationStatus,
  /** BUSINESS o AGENCY (F9.3, ADR-028). */
  kind: organizationKind,
  blockedAt: isoDateTime.nullable(),
  /** Se muestra a la propia organización en el aviso del panel: sabe por qué está bloqueada. */
  blockedReason: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/**
 * Miembro de una organización. Se devuelve `membershipId` y no el id de la fila de usuario como
 * identificador de la acción: cambiar un rol o remover a alguien opera sobre la **membresía**, que
 * es lo que pertenece a la organización — el usuario no.
 */
export const memberResponse = z.object({
  membershipId: uuid,
  userId: uuid,
  email: z.email(),
  role: z.string(),
  status: membershipStatus,
  /** DIRECT = del equipo del negocio; AGENCY = acceso delegado por una agencia (F9.3). */
  source: z.enum(["DIRECT", "AGENCY"]),
});

export const invitationResponse = z.object({
  membershipId: uuid,
});

/** Una organización de mi lista, con cómo llegué a ella (F9.3): propia o delegada por una agencia. */
export const myOrganizationResponse = organizationResponse.extend({ access: organizationAccessResponse });
export type MyOrganizationResponse = z.infer<typeof myOrganizationResponse>;

export type OrganizationResponse = z.infer<typeof organizationResponse>;
export type MemberResponse = z.infer<typeof memberResponse>;
export type InvitationResponse = z.infer<typeof invitationResponse>;
