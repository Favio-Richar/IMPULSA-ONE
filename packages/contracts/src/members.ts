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
  /** `INVITED`: lo dio de alta el negocio. `PURCHASED`: entró pagando (F10.2) y su acceso depende de su periodo. */
  source: z.enum(["INVITED", "PURCHASED"]),
  /** Hasta cuándo llega su acceso pagado (solo `PURCHASED` con un periodo vigente); `null` si no aplica o ya venció. */
  paidUntil: isoDateTime.nullable(),
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

// ───────────────────────────── F10.2: planes de membresía ─────────────────────────────

const membershipPeriod = z.enum(["MONTHLY", "YEARLY"]);

/** Plan visto desde el panel. */
export const membershipPlanResponse = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  priceAmount: z.number().int(),
  priceCurrency: z.string(),
  period: membershipPeriod,
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  /** Miembros con un periodo vigente de este plan. */
  activeMembers: z.number().int(),
  createdAt: isoDateTime,
});

export const membershipPlanListResponse = z.object({
  plans: z.array(membershipPlanResponse),
  /** `false` si el negocio no conectó su cuenta de Mercado Pago o la plataforma no tiene el cobro configurado. */
  checkoutAvailable: z.boolean(),
  /** Cobrado en el mes en curso (hora de Santiago), por moneda. Solo pagos aprobados y sin devolución total. */
  monthRevenue: z.array(z.object({ currency: z.string(), amount: z.number().int(), purchases: z.number().int() })),
});

/** Plan visto por el visitante: nada interno. */
export const publicMembershipPlanResponse = z.object({
  id: uuid,
  name: z.string(),
  description: z.string().nullable(),
  priceAmount: z.number().int(),
  priceCurrency: z.string(),
  period: membershipPeriod,
});

export const publicMembershipPlansResponse = z.object({
  checkoutAvailable: z.boolean(),
  plans: z.array(publicMembershipPlanResponse),
});

export const membershipCheckoutResponse = z.object({ checkoutUrl: z.string(), statusUrl: z.string() });

/** «Tu membresía»: el enlace del correo (o el regreso de Mercado Pago) es la credencial. Sin correo ni datos del pago. */
export const publicMembershipStatusResponse = z.object({
  siteSlug: z.string(),
  siteName: z.string(),
  planName: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.enum(["PENDING", "PAID", "EXPIRED"]),
  paymentStatus: z.string().nullable(),
  checkoutUrl: z.string().nullable(),
  periodEnd: isoDateTime.nullable(),
});

export type MembershipPlanResponse = z.infer<typeof membershipPlanResponse>;
export type MembershipPlanListResponse = z.infer<typeof membershipPlanListResponse>;
export type PublicMembershipPlanResponse = z.infer<typeof publicMembershipPlanResponse>;
export type PublicMembershipPlansResponse = z.infer<typeof publicMembershipPlansResponse>;
export type PublicMembershipStatusResponse = z.infer<typeof publicMembershipStatusResponse>;
export type MemberSessionResponse = z.infer<typeof memberSessionResponse>;
export type SiteMemberResponse = z.infer<typeof siteMemberResponse>;
export type SiteMemberListResponse = z.infer<typeof siteMemberListResponse>;
export type MemberSettingsResponse = z.infer<typeof memberSettingsResponse>;
