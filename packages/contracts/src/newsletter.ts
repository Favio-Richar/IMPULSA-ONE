import { z } from "zod";

// Newsletter con doble confirmación (F7.4, ADR-019).

/** Respuesta a la solicitud: siempre la misma, exista o no el contacto (sin pistas para terceros). */
export const publicNewsletterSignupResponse = z.object({ status: z.literal("pending") });

/** Lo que ve quien abre el enlace del correo, antes y después de confirmar. */
export const publicNewsletterConfirmationResponse = z.object({
  organizationName: z.string(),
  siteName: z.string(),
  /** "an•••@ejemplo.cl": confirma a quién sin mostrar el correo entero a quien tenga el enlace. */
  maskedEmail: z.string(),
  state: z.enum(["pending", "confirmed", "expired"]),
});

export const newsletterStatsResponse = z.object({
  /** Contactos con consentimiento de marketing vigente (la audiencia de las campañas). */
  marketingAudience: z.number().int(),
  /** Confirmados por la newsletter (doble confirmación), vigentes. */
  confirmedSubscribers: z.number().int(),
  /** Solicitudes sin confirmar que todavía no vencen. */
  pendingConfirmations: z.number().int(),
  confirmedLast30Days: z.number().int(),
});

export type PublicNewsletterSignupResponse = z.infer<typeof publicNewsletterSignupResponse>;
export type PublicNewsletterConfirmationResponse = z.infer<typeof publicNewsletterConfirmationResponse>;
export type NewsletterStatsResponse = z.infer<typeof newsletterStatsResponse>;
