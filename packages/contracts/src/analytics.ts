import { z } from "zod";
import { uuid } from "./primitives.js";

// Contrato del dashboard de conversión (F3.7, PM §9.12). Todo sale de `AnalyticsAggregate` (F3.6),
// nunca de escanear `AnalyticsEvent` crudo: es la vista de uso más frecuente del panel.

const day = z.iso.date();

/** Un día del rango, siempre presente aunque valga cero: el gráfico no debe "saltarse" días
 *  sin actividad (una serie con huecos miente sobre la tendencia). */
export const analyticsSeriesPoint = z.object({
  date: day,
  pageViews: z.number().int(),
  visitors: z.number().int(),
  clicks: z.number().int(),
  leads: z.number().int(),
});

/** Una fila de un ranking (dispositivo, país, fuente de campaña...). */
export const analyticsBreakdownRow = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number().int(),
});

/** Un objeto concreto (página, bloque, formulario, enlace, QR) con su nombre ya resuelto. */
export const analyticsSubjectRow = z.object({
  id: uuid,
  /** Nombre propio del objeto (texto del botón, nombre del formulario, `/s/slug`...). Nulo si no
   *  tiene uno: el panel muestra entonces el nombre del tipo (`kind`). */
  label: z.string().nullable(),
  /** Tipo de bloque (`link`, `whatsapp`...) en bloques; nulo en el resto. */
  kind: z.string().nullable(),
  /** Contexto corto para distinguir dos iguales: tipo de bloque y página, slug del enlace... */
  detail: z.string().nullable(),
  value: z.number().int(),
  /** Solo en formularios: cuántos de esos envíos crearon un lead nuevo. */
  secondaryValue: z.number().int().nullable(),
  /** El objeto ya no existe (bloque borrado, página restaurada): se muestra igual, sin enlace. */
  deleted: z.boolean(),
});

export const analyticsOverviewResponse = z.object({
  range: z.object({ from: day, to: day }),
  siteId: uuid.nullable(),
  totals: z.object({
    pageViews: z.number().int(),
    /** Suma de visitantes únicos **por día** (el visitante anonimizado rota cada día, ADR-004):
     *  quien vuelve otro día cuenta de nuevo. Es la medida honesta que permite la minimización. */
    visitors: z.number().int(),
    blockClicks: z.number().int(),
    whatsappClicks: z.number().int(),
    formSubmits: z.number().int(),
    leads: z.number().int(),
    /** Contactos nuevos en el rango, por cualquier vía (formulario o alta manual). Nivel
     *  organización: un contacto no pertenece a un sitio. */
    newContacts: z.number().int(),
    shortLinkClicks: z.number().int(),
    qrScans: z.number().int(),
  }),
  /** `leads / visitors`, o nulo sin visitantes (no "0 %", que sugeriría que hubo con qué medir). */
  conversionRate: z.number().nullable(),
  series: z.array(analyticsSeriesPoint),
  funnel: z.array(z.object({ step: z.enum(["visitors", "clicks", "formSubmits", "leads"]), value: z.number().int() })),
  devices: z.array(analyticsBreakdownRow),
  countries: z.array(analyticsBreakdownRow),
  utmSources: z.array(analyticsBreakdownRow),
  utmCampaigns: z.array(analyticsBreakdownRow),
  topPages: z.array(analyticsSubjectRow),
  topBlocks: z.array(analyticsSubjectRow),
  forms: z.array(analyticsSubjectRow),
  shortLinks: z.array(analyticsSubjectRow),
  qrCodes: z.array(analyticsSubjectRow),
});

export type AnalyticsSeriesPoint = z.infer<typeof analyticsSeriesPoint>;
export type AnalyticsBreakdownRow = z.infer<typeof analyticsBreakdownRow>;
export type AnalyticsSubjectRow = z.infer<typeof analyticsSubjectRow>;
export type AnalyticsOverviewResponse = z.infer<typeof analyticsOverviewResponse>;
