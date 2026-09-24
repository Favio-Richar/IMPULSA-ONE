import { z } from "zod";
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
});

export const invitationResponse = z.object({
  membershipId: uuid,
});

export type OrganizationResponse = z.infer<typeof organizationResponse>;
export type MemberResponse = z.infer<typeof memberResponse>;
export type InvitationResponse = z.infer<typeof invitationResponse>;
