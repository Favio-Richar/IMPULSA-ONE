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
  /** Si tiene un rol personalizado (F9.6a): `role` trae entonces su nombre. */
  customRoleId: uuid.nullable(),
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

// ---- roles personalizados (F9.6a, ADR-028 §3) -------------------------------------------------------------------------
// Los cuerpos de petición viven en `@impulza/validation` (`team/`).

export const customRoleResponse = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  /** Claves del catálogo cerrado de permisos, ordenadas. */
  permissions: z.array(z.string()),
  /** Cuántas personas lo tienen hoy: un rol en uso no se borra. */
  memberCount: z.number().int().nonnegative(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const systemRoleResponse = z.object({
  name: z.string(),
  /** Roles que se pueden asignar a mano; OWNER y los de plataforma o agencia se muestran pero no se asignan. */
  assignable: z.boolean(),
  permissions: z.array(z.string()),
});

export const rolesResponse = z.object({
  system: z.array(systemRoleResponse),
  custom: z.array(customRoleResponse),
  /** Lo que tiene quien consulta: el editor deshabilita lo que no puede entregar (el servidor lo vuelve a comprobar). */
  actorPermissions: z.array(z.string()),
  maxCustomRoles: z.number().int().positive(),
});

export type CustomRoleResponse = z.infer<typeof customRoleResponse>;
export type SystemRoleResponse = z.infer<typeof systemRoleResponse>;
export type RolesResponse = z.infer<typeof rolesResponse>;
