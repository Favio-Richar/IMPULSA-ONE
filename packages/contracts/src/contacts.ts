import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Contratos del mini-CRM (F3.3). Mismo criterio que el resto: catálogos cerrados repetidos a
// propósito porque este paquete no depende de `@impulza/validation`.
export const CONTACT_COMMERCIAL_STATUS_VALUES = ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const;
export const contactCommercialStatus = z.enum(CONTACT_COMMERCIAL_STATUS_VALUES);

export const CONSENT_STATUS_VALUES = ["GRANTED", "WITHDRAWN", "UNKNOWN"] as const;
export const consentStatus = z.enum(CONSENT_STATUS_VALUES);

export const CONTACT_EVENT_TYPE_VALUES = ["FORM_SUBMISSION", "BOOKING", "PURCHASE", "NOTE"] as const;
export const contactEventType = z.enum(CONTACT_EVENT_TYPE_VALUES);

export const contactEventResponse = z.object({
  id: uuid,
  type: contactEventType,
  /** Forma según `type`: `{formId, submissionId}` para `FORM_SUBMISSION`, texto libre para `NOTE`
   *  (F3.3). `unknown` a propósito, mismo criterio que `BlockResponse.config`. */
  payload: z.unknown().nullable(),
  createdAt: isoDateTime,
});

export const contactResponse = z.object({
  id: uuid,
  organizationId: uuid,
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  source: z.string().nullable(),
  tags: z.array(z.string()),
  consentStatus,
  consentSource: z.string().nullable(),
  consentTextVersion: z.string().nullable(),
  consentAt: isoDateTime.nullable(),
  commercialStatus: contactCommercialStatus,
  assignedToId: uuid.nullable(),
  /** Marcado por el job diario tras 36 meses sin interacción (ADR-004 punto 4): el dueño decide
   *  si lo conserva o lo borra. Nulo = no requiere revisión. */
  retentionReviewAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/** Ficha de contacto (F3.3): el detalle trae también su línea de tiempo, la lista no — mismo
 *  criterio que `pageVersionSummaryResponse` vs `pageVersionResponse` (F2.6). */
export const contactDetailResponse = contactResponse.extend({
  events: z.array(contactEventResponse),
});

export type ContactCommercialStatus = z.infer<typeof contactCommercialStatus>;
export type ConsentStatus = z.infer<typeof consentStatus>;
export type ContactEventType = z.infer<typeof contactEventType>;
export type ContactEventResponse = z.infer<typeof contactEventResponse>;
export type ContactResponse = z.infer<typeof contactResponse>;
export type ContactDetailResponse = z.infer<typeof contactDetailResponse>;
