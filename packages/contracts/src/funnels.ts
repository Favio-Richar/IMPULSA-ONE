import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Embudos de conversión (F7.6, ADR-021). El catálogo de eventos se repite acá porque este paquete
// no depende de `@impulza/validation` (mismo criterio que el resto de los contratos); las pruebas e2e
// de la API parsean respuestas reales contra estos esquemas.

export const funnelStepEvent = z.enum([
  "page_view",
  "block_click",
  "whatsapp_click",
  "form_submit",
  "lead_created",
  "booking_created",
  "order_created",
  "payment",
]);

export const funnelStepResponse = z.object({
  label: z.string(),
  events: z.array(funnelStepEvent),
  /** Página o bloque concreto del paso, o `null` = cualquiera. */
  subjectId: uuid.nullable(),
  /** Nombre legible del sujeto ("Inicio", "Botón: Reservar"), o `null` si ya no existe o no hay. */
  subjectLabel: z.string().nullable(),
});

export const funnelResponse = z.object({
  id: uuid,
  siteId: uuid,
  name: z.string(),
  steps: z.array(funnelStepResponse),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const funnelReportStepResponse = z.object({
  label: z.string(),
  /** Visitas (personas-día) que llegaron a este paso habiendo pasado por todos los anteriores en orden. */
  visitors: z.number().int(),
  /** Fracción (0–1) respecto del paso anterior; `null` en el primero o si el anterior tuvo 0. */
  conversionFromPrevious: z.number().nullable(),
  /** Fracción (0–1) respecto del primer paso; `null` si el primero tuvo 0. */
  conversionFromStart: z.number().nullable(),
  /** Visitas del paso anterior que no llegaron a este (0 en el primero). */
  dropOff: z.number().int(),
  /** Fracción (0–1) de abandono respecto del paso anterior; `null` en el primero o si el anterior tuvo 0. */
  dropOffRate: z.number().nullable(),
  /** Mediana, en segundos, del tiempo desde el paso anterior; `null` en el primero o sin datos. */
  medianSecondsFromPrevious: z.number().nullable(),
});

export const funnelReportResponse = z.object({
  funnelId: uuid,
  from: z.iso.date(),
  to: z.iso.date(),
  device: z.enum(["mobile", "tablet", "desktop"]).nullable(),
  steps: z.array(funnelReportStepResponse),
  /** Conversión total: último paso sobre el primero (0–1), o `null` si nadie entró. */
  overallConversion: z.number().nullable(),
  /** Índice (desde 0) del paso con más abandono, o `null` si nadie abandonó. */
  biggestDropOffStep: z.number().int().nullable(),
});

export type FunnelStepResponse = z.infer<typeof funnelStepResponse>;
export type FunnelResponse = z.infer<typeof funnelResponse>;
export type FunnelReportStepResponse = z.infer<typeof funnelReportStepResponse>;
export type FunnelReportResponse = z.infer<typeof funnelReportResponse>;
