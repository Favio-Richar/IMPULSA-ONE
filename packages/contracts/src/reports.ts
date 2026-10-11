import { z } from "zod";
import { analyticsSeriesPoint, analyticsSubjectRow } from "./analytics.js";
import { isoDateTime, uuid } from "./primitives.js";

// ---- informe por cliente (F9.8, ADR-028 §6) ----------------------------------------------------------------------------
// Los parámetros de consulta viven en `@impulza/validation` (`reports/`). Solo cifras agregadas: ningún dato personal de contactos.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.object({ from: day, to: day });

const delta = z.object({
  /** Valor del periodo comparado, o `null` si no hay datos de ese periodo (p. ej. fuera del historial del plan). */
  base: z.number().nullable(),
  change: z.number().nullable(),
  /** Variación relativa; `null` si la base es 0 o no existe. */
  ratio: z.number().nullable(),
});

export const reportMetricResponse = z.object({
  key: z.enum(["pageViews", "visitors", "blockClicks", "whatsappClicks", "leads", "newContacts", "bookings", "orders", "revenue"]),
  label: z.string(),
  value: z.number(),
  previous: delta,
  lastYear: delta,
});

export const reportResponse = z.object({
  organizationName: z.string(),
  period,
  previousPeriod: period,
  lastYearPeriod: period,
  /** Si cada comparación se pudo calcular (el historial de analítica del plan puede no llegar tan atrás). */
  comparison: z.object({ previousAvailable: z.boolean(), lastYearAvailable: z.boolean() }),
  metrics: z.array(reportMetricResponse),
  conversion: z.object({ value: z.number().nullable(), previous: z.number().nullable(), lastYear: z.number().nullable() }),
  /** Moneda de las ventas del informe (la de los pedidos pagados), o `null` si no hubo. */
  currency: z.string().nullable(),
  series: z.array(analyticsSeriesPoint),
  topBlocks: z.array(analyticsSubjectRow),
  topPages: z.array(analyticsSubjectRow),
  generatedAt: isoDateTime,
});
export type ReportResponse = z.infer<typeof reportResponse>;
export type ReportMetricResponse = z.infer<typeof reportMetricResponse>;

// ---- enlace compartido (F9.8b) ---------------------------------------------------------------------------------------------

export const reportShareLinkResponse = z.object({
  id: uuid,
  label: z.string().nullable(),
  period,
  expiresAt: isoDateTime,
  revokedAt: isoDateTime.nullable(),
  /** Vigente = ni vencido ni revocado. */
  active: z.boolean(),
  createdAt: isoDateTime,
  lastAccessedAt: isoDateTime.nullable(),
  accessCount: z.number().int().nonnegative(),
});
export type ReportShareLinkResponse = z.infer<typeof reportShareLinkResponse>;

/** Al crear: el enlace completo viaja SOLO en esta respuesta; después ya no se puede recuperar (solo se guarda su hash). */
export const createdReportShareLinkResponse = reportShareLinkResponse.extend({ token: z.string() });
export type CreatedReportShareLinkResponse = z.infer<typeof createdReportShareLinkResponse>;

/** Lo que ve quien abre un enlace: el informe (cifras agregadas) y la marca pública de quien lo comparte. Sin ids internos. */
export const publicReportResponse = z.object({
  report: reportResponse,
  brand: z.object({ displayName: z.string(), logoLightUrl: z.string().nullable(), primaryColor: z.string() }),
  expiresAt: isoDateTime,
});
export type PublicReportResponse = z.infer<typeof publicReportResponse>;

