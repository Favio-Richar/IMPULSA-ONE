import { z } from "zod";
import { isoDateTime } from "./primitives.js";

// Tarjeta digital del sitio (F10.4, ADR-029).

const social = z.object({ network: z.string(), url: z.string() });

/** Lo que el negocio publica en su tarjeta. */
export const digitalCardFields = z.object({
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  address: z.string().nullable(),
  photoUrl: z.string().nullable(),
  socials: z.array(social),
});

/** Para el panel: la tarjeta guardada (o `null` si todavía no existe) y las direcciones públicas. */
export const digitalCardAdminResponse = z.object({
  card: digitalCardFields.extend({ enabled: z.boolean(), updatedAt: isoDateTime }).nullable(),
  /** Página pública de la tarjeta. */
  publicUrl: z.string().nullable(),
  /** ¿Qué pases de wallet puede ofrecer esta plataforma ahora? Sin credenciales, `false` (la tarjeta y la vCard siguen). */
  wallet: z.object({ google: z.boolean(), apple: z.boolean() }),
});

/** Para el público: solo una tarjeta activa. */
export const publicDigitalCardResponse = digitalCardFields.extend({
  siteName: z.string(),
  siteSlug: z.string(),
  wallet: z.object({ google: z.boolean(), apple: z.boolean() }),
});

export const walletGoogleResponse = z.object({ saveUrl: z.string() });

export type DigitalCardAdminResponse = z.infer<typeof digitalCardAdminResponse>;
export type PublicDigitalCardResponse = z.infer<typeof publicDigitalCardResponse>;
