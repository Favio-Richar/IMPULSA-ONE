import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

export const membershipStatus = z.enum(["INVITED", "ACTIVE", "SUSPENDED", "REMOVED"]);

export const organizationResponse = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  planId: uuid.nullable(),
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
