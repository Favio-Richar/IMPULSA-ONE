import { z } from "zod";
import { emailSchema, phoneSchema, plainTextSchema } from "../blocks/primitives.js";

// Mini-CRM (F3.3) — mismo criterio isomorfo que forms/blocks: el servidor vuelve a validar
// siempre (ST §15), este paquete solo describe la forma una vez para cliente y servidor.

export const CONTACT_COMMERCIAL_STATUS_VALUES = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const;
export type ContactCommercialStatus = (typeof CONTACT_COMMERCIAL_STATUS_VALUES)[number];
export const contactCommercialStatusSchema = z.enum(CONTACT_COMMERCIAL_STATUS_VALUES);

export const CONSENT_STATUS_VALUES = ["GRANTED", "WITHDRAWN", "UNKNOWN"] as const;
export type ConsentStatus = (typeof CONSENT_STATUS_VALUES)[number];
export const consentStatusSchema = z.enum(CONSENT_STATUS_VALUES);

export const CONTACT_EVENT_TYPE_VALUES = ["FORM_SUBMISSION", "BOOKING", "PURCHASE", "NOTE"] as const;
export type ContactEventType = (typeof CONTACT_EVENT_TYPE_VALUES)[number];
export const contactEventTypeSchema = z.enum(CONTACT_EVENT_TYPE_VALUES);

const contactTagsSchema = z.array(plainTextSchema(40)).max(20);

/** Alta manual desde el panel (ADR-004: sin paso por un formulario público, consentimiento queda
 *  `UNKNOWN` — no se puede declarar "otorgado" un consentimiento que nadie dio explícitamente). */
export const createContactSchema = z.object({
  name: plainTextSchema(160).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  tags: contactTagsSchema.optional(),
  source: plainTextSchema(120).optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z
  .object({
    name: plainTextSchema(160).nullable().optional(),
    email: emailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    tags: contactTagsSchema.optional(),
    commercialStatus: contactCommercialStatusSchema.optional(),
    assignedToId: z.uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "El cuerpo no puede estar vacío." });

export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const createContactNoteSchema = z.object({
  note: plainTextSchema(2000),
});

export type CreateContactNoteInput = z.infer<typeof createContactNoteSchema>;

/** Filtros de la lista (F3.3): todos opcionales, todos vienen de query string (siempre string). */
export const listContactsQuerySchema = z.object({
  tag: plainTextSchema(40).optional(),
  commercialStatus: contactCommercialStatusSchema.optional(),
  consentStatus: consentStatusSchema.optional(),
  search: plainTextSchema(160).optional(),
  // Solo los marcados para revisión de retención (ADR-004 punto 4).
  retentionReview: z.enum(["pending"]).optional(),
});

export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;
