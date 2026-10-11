import { z } from "zod";
import { cleanPlainText } from "../moderation/abuse-report.js";

/**
 * Miembros de sitio y contenido protegido (F10.1, ADR-029). Reglas compartidas por la API, `apps/web` y el panel.
 * Nada de acá se decide solo en el frontend: el servidor vuelve a aplicarlo siempre.
 */

/** Vida del enlace mágico: lo justo para abrir el correo; después hay que pedir otro. */
export const MEMBER_LOGIN_TOKEN_TTL_MINUTES = 15;
/** Vida de la sesión del miembro. Fija (no se renueva sola): pasado el plazo, vuelve a pedir su enlace. */
export const MEMBER_SESSION_TTL_DAYS = 30;
/** Miembros por sitio: acota lo que una cuenta comprometida puede dar de alta. */
export const MEMBERS_PER_SITE_MAX = 5000;
export const MEMBER_NAME_MAX = 120;
export const MEMBER_SEARCH_MAX = 120;

/** Correo de miembro: minúsculas y sin espacios; la base lo exige también con un `CHECK`. */
export const memberEmailSchema = z
  .string()
  .trim()
  .max(254, "El correo es demasiado largo.")
  .pipe(z.email("Escribe un correo válido."))
  .transform((value) => value.toLowerCase());

const optionalName = z
  .string()
  .max(MEMBER_NAME_MAX * 2)
  .transform(cleanPlainText)
  .pipe(z.string().max(MEMBER_NAME_MAX, `Máximo ${MEMBER_NAME_MAX} caracteres.`));

/** El visitante pide su enlace: solo el correo. La respuesta no revela si existe como miembro. */
export const requestMemberAccessSchema = z.object({ email: memberEmailSchema }).strict();
export type RequestMemberAccessDto = z.infer<typeof requestMemberAccessSchema>;

/** Token de un solo uso o de sesión: 32 bytes en base64url = 43 caracteres. Cualquier otra forma ni se consulta. */
export const MEMBER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const memberTokenSchema = z.string().regex(MEMBER_TOKEN_PATTERN, "Enlace no válido.");

export const verifyMemberAccessSchema = z.object({ token: memberTokenSchema }).strict();
export type VerifyMemberAccessDto = z.infer<typeof verifyMemberAccessSchema>;

/** Alta de un miembro desde el panel. */
export const addMemberSchema = z
  .object({
    email: memberEmailSchema,
    name: optionalName.optional(),
    /** Envía el enlace de acceso por correo al darlo de alta (por defecto, sí). */
    sendAccess: z.boolean().default(true),
  })
  .strict();
export type AddMemberDto = z.infer<typeof addMemberSchema>;

export const listMembersQuerySchema = z.object({
  search: z.string().trim().max(MEMBER_SEARCH_MAX).optional(),
  status: z.enum(["ACTIVE", "REVOKED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListMembersQueryDto = z.infer<typeof listMembersQuerySchema>;

export const setPageMembersOnlySchema = z.object({ enabled: z.boolean() }).strict();
export type SetPageMembersOnlyDto = z.infer<typeof setPageMembersOnlySchema>;

/** Nombre de la cookie de sesión del miembro en `apps/web`: una por sitio, nunca compartida entre sitios. */
export function memberCookieName(siteSlug: string): string {
  return `impulza_member_${siteSlug}`;
}
