import { z } from "zod";
import { isoDateTime } from "./primitives.js";

// Página de suscripción del sitio (extra F10, ADR-029).

/** Lo que el negocio publica en su página de suscripción. */
export const subscribePageFields = z.object({
  title: z.string(),
  description: z.string().nullable(),
  benefits: z.array(z.string()),
  freeEnabled: z.boolean(),
  imageUrl: z.string().nullable(),
});

/** Para el panel: la página guardada (o `null` si todavía no existe), su dirección pública y cuántos miembros activos tiene el sitio. */
export const subscribePageAdminResponse = z.object({
  page: subscribePageFields.extend({ enabled: z.boolean(), updatedAt: isoDateTime }).nullable(),
  publicUrl: z.string().nullable(),
  /** Miembros activos del sitio: suscriptores gratuitos, invitados y de pago. */
  activeMembers: z.number().int().min(0),
});

/** Para el público: solo una página activa. Los planes de pago se piden aparte (`/members/plans`). */
export const publicSubscribePageResponse = subscribePageFields.extend({
  siteName: z.string(),
  siteSlug: z.string(),
});

/** Misma respuesta pase lo que pase (correo nuevo, ya suscrito, revocado, límite): nadie averigua quién es suscriptor. */
export const freeSubscribeResponse = z.object({ sent: z.literal(true) });

export type SubscribePageAdminResponse = z.infer<typeof subscribePageAdminResponse>;
export type PublicSubscribePageResponse = z.infer<typeof publicSubscribePageResponse>;
