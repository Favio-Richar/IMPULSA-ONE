import { z } from "zod";
import { safeUrlSchema } from "../blocks/primitives.js";
import { memberEmailSchema } from "../members/index.js";
import { cleanPlainText } from "../moderation/abuse-report.js";

/**
 * Página de suscripción del sitio (extra F10, ADR-029). Reglas compartidas por la API, `apps/web` y el panel; el servidor las
 * vuelve a aplicar siempre. El botón «Suscribirme» del portal lleva a `/:sitio/s`, una página que el negocio personaliza.
 */

export const SUBSCRIBE_TITLE_MAX = 80;
export const SUBSCRIBE_DESCRIPTION_MAX = 600;
export const SUBSCRIBE_BENEFIT_MAX = 120;
export const SUBSCRIBE_BENEFITS_MAX = 8;
export const SUBSCRIBE_NAME_MAX = 120;
/** Campo trampa del formulario de suscripción gratuita: una persona nunca lo llena. */
export const SUBSCRIBE_HONEYPOT_FIELD = "website";

const text = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanPlainText)
    .pipe(z.string().max(max, `Máximo ${max} caracteres.`));

export const subscribePageSchema = z
  .object({
    enabled: z.boolean(),
    title: text(SUBSCRIBE_TITLE_MAX).pipe(z.string().min(2, "Escribe un título.")),
    description: text(SUBSCRIBE_DESCRIPTION_MAX).nullable().optional(),
    benefits: z
      .array(text(SUBSCRIBE_BENEFIT_MAX).pipe(z.string().min(1)))
      .max(SUBSCRIBE_BENEFITS_MAX, `Máximo ${SUBSCRIBE_BENEFITS_MAX} beneficios.`)
      .default([]),
    /** Ofrecer también la suscripción gratuita (los planes de pago se ofrecen siempre que el negocio los tenga). */
    freeEnabled: z.boolean().default(true),
    imageUrl: safeUrlSchema.nullable().optional(),
  })
  .strict();
export type SubscribePageDto = z.infer<typeof subscribePageSchema>;

/** Suscripción gratuita: solo correo y, si quiere, nombre. La respuesta es la misma pase lo que pase (sin enumeración). */
export const freeSubscribeSchema = z
  .object({
    email: memberEmailSchema,
    name: text(SUBSCRIBE_NAME_MAX).optional(),
    [SUBSCRIBE_HONEYPOT_FIELD]: z.string().max(500).optional(),
  })
  .strict();
export type FreeSubscribeDto = z.infer<typeof freeSubscribeSchema>;

/** Dirección de la página de suscripción de un sitio (`/s`: una sola letra, como `/c` y `/t`, nunca choca con una página). */
export function subscribePath(siteSlug: string): string {
  return `/${siteSlug}/s`;
}
