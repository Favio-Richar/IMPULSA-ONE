import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Modo campaña (F7.7, ADR-022). Listas cerradas repetidas acá porque este paquete no depende de
// `@impulza/validation`; las pruebas e2e de la API parsean respuestas reales contra estos esquemas.

export const pageCampaignResponse = z.object({
  id: uuid,
  siteId: uuid,
  pageId: uuid,
  /** Slug vigente de la página, o `null` si la página está en la papelera. */
  pageSlug: z.string().nullable(),
  name: z.string(),
  objective: z.enum(["captar", "vender", "reservar", "mostrar", "compartir"]),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  replaceHome: z.boolean(),
  utmCampaign: z.string(),
  /** Calculado con la hora del servidor: programada, activa, terminada o cancelada. */
  status: z.enum(["scheduled", "active", "ended", "cancelled"]),
  cancelledAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const pageCampaignReportResponse = z.object({
  campaignId: uuid,
  /** Ventana medida: del inicio hasta el fin (o hasta ahora, si sigue activa). */
  from: isoDateTime,
  to: isoDateTime,
  /** Visitas del día (anónimas, ADR-004) que vieron la página de la campaña en la ventana. */
  visitors: z.number().int(),
  /** De esas visitas, cuántas después hicieron cada cosa (cada visita cuenta una vez por fila). */
  interactions: z.number().int(),
  leads: z.number().int(),
  bookings: z.number().int(),
  orders: z.number().int(),
  payments: z.number().int(),
  /** Visitas que terminaron en contacto, reserva o pedido, sobre las visitas (0–1), o `null`. */
  conversion: z.number().nullable(),
  /** Visitas por `utm_source` de la vista (`null` = directo o sin UTM), de mayor a menor. */
  sources: z.array(z.object({ source: z.string().nullable(), visitors: z.number().int() })),
});

export type PageCampaignResponse = z.infer<typeof pageCampaignResponse>;
export type PageCampaignReportResponse = z.infer<typeof pageCampaignReportResponse>;
