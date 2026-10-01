import { z } from "zod";
import { plainTextSchema } from "../blocks/primitives.js";

// Newsletter con doble confirmación (F7.4, ADR-019). La solicitud no crea un contacto: queda una
// confirmación pendiente hasta que la persona presiona "Confirmar" desde el enlace de su correo.

/** Versión del texto que acepta la persona (se guarda con el consentimiento, ADR-004). */
export const NEWSLETTER_CONSENT_TEXT_VERSION = "newsletter-v1";
export const NEWSLETTER_CONSENT_LABEL = "Quiero recibir novedades por correo. Puedo darme de baja cuando quiera.";

/** Horas que vale el enlace de confirmación. */
export const NEWSLETTER_CONFIRMATION_TTL_HOURS = 48;
/** Correos de confirmación por dirección y sitio en 24 h; los siguientes se descartan en silencio. */
export const NEWSLETTER_MAX_EMAILS_PER_DAY = 3;
/** Días que se guarda una confirmación ya hecha (la prueba queda en el contacto y la auditoría). */
export const NEWSLETTER_CONFIRMED_RETENTION_DAYS = 30;
/** Etiqueta que recibe el contacto al confirmar (sirve para segmentar campañas). */
export const NEWSLETTER_TAG = "newsletter";
/** Campo trampa: invisible para personas; si llega con contenido, es un robot. */
export const NEWSLETTER_HONEYPOT_FIELD = "website";

export const newsletterSignupSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).pipe(z.email("Escribe un correo válido, por ejemplo nombre@correo.cl.")),
  name: plainTextSchema(120).optional(),
  consent: z.literal(true, "Marca la casilla para confirmar que quieres recibir correos."),
  [NEWSLETTER_HONEYPOT_FIELD]: z.string().max(500).optional(),
});
export type NewsletterSignupInput = z.infer<typeof newsletterSignupSchema>;

/** Fuente del consentimiento de marketing registrado al confirmar. */
export function newsletterConsentSource(siteId: string): string {
  return `newsletter:${siteId}:double_opt_in`;
}

export interface NewsletterEmail {
  subject: string;
  text: string;
}

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** Correo con el enlace para confirmar (lo único que prueba que el correo es de quien lo pidió). */
export function newsletterConfirmationEmail(data: { siteName: string; confirmUrl: string; name?: string | null }): NewsletterEmail {
  return {
    subject: oneLine(`Confirma tu suscripción a ${data.siteName}`),
    text: [
      data.name ? `Hola, ${oneLine(data.name)}:` : "Hola:",
      "",
      `Pediste recibir las novedades de ${oneLine(data.siteName)}. Para confirmarlo, abre este enlace y presiona «Confirmar»:`,
      "",
      data.confirmUrl,
      "",
      `El enlace vale ${NEWSLETTER_CONFIRMATION_TTL_HOURS} horas. Si no fuiste tú, ignora este correo: sin confirmar no te escribiremos.`,
    ].join("\n"),
  };
}

/** A quien ya está suscrito: un aviso sin enlace (la respuesta pública es la misma para todos). */
export function newsletterAlreadySubscribedEmail(data: { siteName: string }): NewsletterEmail {
  return {
    subject: oneLine(`Ya estás suscrito a ${data.siteName}`),
    text: [
      "Hola:",
      "",
      `Alguien pidió suscribir este correo a las novedades de ${oneLine(data.siteName)}, pero ya estabas suscrito, así que no hay nada que hacer.`,
      "",
      "Si no fuiste tú, ignora este correo. Cada correo que te enviemos trae un enlace para darte de baja.",
    ].join("\n"),
  };
}

export const NEWSLETTER_CONFIRMATION_STATES = ["pending", "confirmed", "expired"] as const;
export type NewsletterConfirmationState = (typeof NEWSLETTER_CONFIRMATION_STATES)[number];
