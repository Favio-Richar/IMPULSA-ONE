import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Miembros de sitio y contenido protegido (F10.1, ADR-029).

/** Respuesta al pedir el enlace: idéntica exista o no el correo como miembro (sin enumeración). */
export const memberAccessRequestedResponse = z.object({ sent: z.literal(true) });

/** Canje del enlace mágico: la sesión viaja una sola vez; `apps/web` la guarda en una cookie `HttpOnly`. */
export const memberSessionResponse = z.object({
  siteSlug: z.string(),
  sessionToken: z.string(),
  expiresAt: isoDateTime,
});

export const memberIdentityResponse = z.object({ email: z.string(), name: z.string().nullable() });

export const siteMemberResponse = z.object({
  id: uuid,
  email: z.string(),
  name: z.string().nullable(),
  status: z.enum(["ACTIVE", "REVOKED"]),
  lastAccessAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const siteMemberListResponse = z.object({
  items: z.array(siteMemberResponse),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

/** Páginas del sitio con su marca «solo miembros», para el panel. */
export const memberSettingsResponse = z.object({
  pages: z.array(z.object({ id: uuid, slug: z.string(), isHome: z.boolean(), membersOnly: z.boolean(), published: z.boolean() })),
  memberCount: z.number().int(),
});

export type MemberSessionResponse = z.infer<typeof memberSessionResponse>;
export type SiteMemberResponse = z.infer<typeof siteMemberResponse>;
export type SiteMemberListResponse = z.infer<typeof siteMemberListResponse>;
export type MemberSettingsResponse = z.infer<typeof memberSettingsResponse>;
