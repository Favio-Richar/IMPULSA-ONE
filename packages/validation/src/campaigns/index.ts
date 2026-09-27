import { z } from "zod";
import { plainTextSchema, richTextSchema } from "../blocks/primitives.js";
import { CONTACT_COMMERCIAL_STATUS_VALUES } from "../contacts/index.js";

// Campañas de email (F5.6). Solo a contactos con consentimiento de **marketing** (casilla explícita
// y no premarcada, aparte del consentimiento para gestionar una reserva o un pedido) y que no se
// dieron de baja. Esquemas compartidos por la API (que siempre revalida), el worker y el panel.

/** Versión del texto de la casilla de marketing: se guarda junto al consentimiento (ADR-004). */
export const MARKETING_CONSENT_TEXT_VERSION = "marketing-v1";
export const MARKETING_CONSENT_LABEL = "Quiero recibir novedades y promociones de este negocio por correo (opcional).";

export const CAMPAIGN_STATUSES = ["DRAFT", "SENDING", "SENT", "CANCELLED"] as const;
export type CampaignStatusValue = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatusValue, string> = {
  DRAFT: "Borrador",
  SENDING: "Enviando",
  SENT: "Enviada",
  CANCELLED: "Detenida",
};

export const CONTACT_COMMERCIAL_STATUS_LABELS: Record<(typeof CONTACT_COMMERCIAL_STATUS_VALUES)[number], string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  QUALIFIED: "Calificado",
  WON: "Ganado",
  LOST: "Perdido",
};

/**
 * Segmento: quién recibe la campaña, además de la regla fija de consentimiento de marketing sin
 * baja. Cada lista vacía o ausente = sin filtro por ese criterio; dentro de un criterio, basta con
 * cumplir uno de los valores (etiqueta A **o** B); entre criterios, todos (etiqueta **y** estado).
 */
export const campaignSegmentSchema = z.object({
  tags: z.array(plainTextSchema(40)).max(20).default([]),
  sources: z.array(plainTextSchema(80)).max(20).default([]),
  commercialStatuses: z.array(z.enum(CONTACT_COMMERCIAL_STATUS_VALUES)).max(5).default([]),
});
export type CampaignSegment = z.infer<typeof campaignSegmentSchema>;

export const campaignSchema = z.object({
  name: plainTextSchema(120),
  subject: plainTextSchema(150),
  bodyHtml: richTextSchema,
  segment: campaignSegmentSchema.default({ tags: [], sources: [], commercialStatuses: [] }),
});
export type CampaignInput = z.infer<typeof campaignSchema>;

export const updateCampaignSchema = campaignSchema.partial();
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

/** Tope técnico de destinatarios por campaña; el ritmo lo da el límite por hora del plan. */
export const MAX_CAMPAIGN_RECIPIENTS = 20_000;

/**
 * Texto plano de un HTML **ya saneado** (lista corta de etiquetas, sin atributos salvo `href`):
 * párrafos y títulos separados por una línea en blanco, viñetas con "•", enlaces como
 * "texto (url)". Sirve de versión texto del correo y de vista previa sin HTML.
 */
export function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, label: string) => {
      const inner = label.replace(/<[^>]+>/g, "").trim();
      return inner && inner !== href ? `${inner} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|h2|h3|h4|blockquote|ul|ol)>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface CampaignEmailInput {
  organizationName: string;
  subject: string;
  /** HTML saneado de la campaña. */
  bodyHtml: string;
  /** Enlace firmado de baja; `null` solo en un envío de prueba. */
  unsubscribeUrl: string | null;
  test?: boolean;
}

export interface CampaignEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Correo de una campaña: el cuerpo del negocio más un pie fijo con quién lo envía, por qué lo recibe
 * y el enlace de baja (siempre, en texto y en HTML). Un envío de prueba lo avisa en el asunto.
 */
export function campaignEmail(input: CampaignEmailInput): CampaignEmail {
  const subject = oneLine(`${input.test ? "[Prueba] " : ""}${input.subject}`);
  const why = `Recibes este correo porque aceptaste recibir novedades de ${input.organizationName}.`;
  const unsubscribeText = input.unsubscribeUrl
    ? `Si no quieres recibir más correos: ${input.unsubscribeUrl}`
    : "Envío de prueba: en la campaña real aquí va el enlace para darse de baja.";
  const text = [htmlToPlainText(input.bodyHtml), "", "—", why, unsubscribeText].join("\n");
  const footerLink = input.unsubscribeUrl
    ? `<a href="${escapeHtml(input.unsubscribeUrl)}">Darme de baja</a>`
    : "Envío de prueba: en la campaña real aquí va el enlace para darse de baja.";
  const html = [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.55;color:#1f2933;max-width:600px;margin:0 auto;padding:24px">`,
    input.bodyHtml,
    `<hr style="border:none;border-top:1px solid #d9dee3;margin:32px 0 16px">`,
    `<p style="font-size:13px;color:#52606d;margin:0">${escapeHtml(why)}<br>${footerLink}</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}
