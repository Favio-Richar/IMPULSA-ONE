import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Campañas de email (F5.6).

const commercialStatus = z.enum(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"]);

export const campaignSegmentResponse = z.object({
  tags: z.array(z.string()),
  sources: z.array(z.string()),
  commercialStatuses: z.array(commercialStatus),
});

export const campaignStatsResponse = z.object({
  pending: z.number().int(),
  sent: z.number().int(),
  /** Fallos del proveedor al enviar (los rebotes reales llegan cuando exista un proveedor con avisos). */
  failed: z.number().int(),
  skipped: z.number().int(),
  unsubscribed: z.number().int(),
});

export const campaignResponse = z.object({
  id: uuid,
  name: z.string(),
  subject: z.string(),
  bodyHtml: z.string(),
  segment: campaignSegmentResponse,
  status: z.enum(["DRAFT", "SENDING", "SENT", "CANCELLED"]),
  recipientCount: z.number().int(),
  emailsPerHour: z.number().int().nullable(),
  stats: campaignStatsResponse,
  sendStartedAt: isoDateTime.nullable(),
  sentAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type CampaignResponse = z.infer<typeof campaignResponse>;

/** A cuántos llegaría un segmento, y el total con consentimiento de marketing (para contexto). */
export const campaignAudienceResponse = z.object({
  eligible: z.number().int(),
  withMarketingConsent: z.number().int(),
  totalContacts: z.number().int(),
});
export type CampaignAudienceResponse = z.infer<typeof campaignAudienceResponse>;

/** Etiquetas y fuentes que existen en los contactos de la organización (para armar el segmento). */
export const campaignSegmentOptionsResponse = z.object({
  tags: z.array(z.string()),
  sources: z.array(z.string()),
});
export type CampaignSegmentOptionsResponse = z.infer<typeof campaignSegmentOptionsResponse>;

/** Página pública de baja: sin ids ni datos del negocio más allá de su nombre. */
export const publicUnsubscribeResponse = z.object({
  organizationName: z.string(),
  /** Correo enmascarado ("an•••@ejemplo.cl"): confirma a quién sin exponerlo entero. */
  maskedEmail: z.string(),
  unsubscribed: z.boolean(),
});
export type PublicUnsubscribeResponse = z.infer<typeof publicUnsubscribeResponse>;
