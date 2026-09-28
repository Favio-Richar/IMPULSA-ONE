import { z } from "zod";

// IA comercial (F6.4). Lo que la IA recibe es un resumen **agregado** del sitio (visitas, clics,
// leads, conversión, dispositivos, campañas, bloques más usados) y los códigos de hallazgo de la
// salud de página (F6.1): nunca contactos, correos, teléfonos, ids ni eventos individuales. La
// decisión de si hay muestra suficiente para hablar de tendencias la toma este código, no el modelo:
// sin muestra, el resumen ni siquiera trae el período anterior, así el modelo no tiene con qué
// inventar una tendencia.

/** Períodos que se pueden analizar, en días. Lista cerrada: el mismo corte que el panel de analítica. */
export const AI_INSIGHTS_PERIODS = [7, 30, 90] as const;
export type AiInsightsPeriod = (typeof AI_INSIGHTS_PERIODS)[number];

export const aiInsightsRequestSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});
export type AiInsightsRequest = z.infer<typeof aiInsightsRequestSchema>;

/**
 * Visitantes mínimos (en cada período) para comparar y hablar de tendencias. Con menos, una
 * diferencia de "+100 %" puede ser una sola persona. Criterio conservador y documentado: se prefiere
 * decir "todavía no hay suficiente" a dar una lectura equivocada.
 */
export const INSIGHTS_MIN_VISITORS = 50;

export const AI_INSIGHT_ACTION_KINDS = ["fix_page", "content", "acquisition", "conversion"] as const;
export type AiInsightActionKind = (typeof AI_INSIGHT_ACTION_KINDS)[number];

export const AI_INSIGHT_ACTION_LABELS: Record<AiInsightActionKind, string> = {
  fix_page: "Corregir la página",
  content: "Contenido",
  acquisition: "Atraer visitas",
  conversion: "Convertir más",
};

/** Lo mínimo de un resumen de analítica que usa el análisis (compatible con `analyticsOverviewResponse`). */
export interface InsightsPeriodInput {
  range: { from: string; to: string };
  totals: { pageViews: number; visitors: number; blockClicks: number; whatsappClicks: number; formSubmits: number; leads: number; newContacts: number };
  conversionRate: number | null;
  devices: Array<{ key: string; value: number }>;
  utmSources: Array<{ key: string; value: number }>;
  utmCampaigns: Array<{ key: string; value: number }>;
  topBlocks: Array<{ label: string | null; kind: string | null; value: number; deleted: boolean }>;
}

export interface InsightsHealthInput {
  score: number;
  findings: Array<{ code: string; severity: string; blockType?: string | null }>;
}

export interface InsightsSample {
  enough: boolean;
  visitors: number;
  minimum: number;
  /** Hay período anterior con muestra suficiente: se puede comparar. */
  comparable: boolean;
}

function periodMetrics(input: InsightsPeriodInput) {
  const clicks = input.totals.blockClicks + input.totals.whatsappClicks;
  return {
    visitas: input.totals.pageViews,
    visitantes: input.totals.visitors,
    clics: clicks,
    clicsWhatsapp: input.totals.whatsappClicks,
    enviosFormulario: input.totals.formSubmits,
    leads: input.totals.leads,
    contactosNuevos: input.totals.newContacts,
    conversionPorcentaje: input.conversionRate === null ? null : round(input.conversionRate * 100, 1),
    clicsPorVisitante: input.totals.visitors > 0 ? round(clicks / input.totals.visitors, 2) : null,
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Variación porcentual redondeada, o `null` si no hay base. */
function change(current: number, previous: number): number | null {
  return previous > 0 ? round(((current - previous) / previous) * 100, 0) : null;
}

/**
 * Resumen que se le manda al modelo, sin datos personales ni ids. Solo compara con el período
 * anterior si **los dos** tienen muestra suficiente.
 */
export function buildInsightsDigest(input: { current: InsightsPeriodInput; previous: InsightsPeriodInput | null; health: InsightsHealthInput | null }) {
  const { current, previous, health } = input;
  const enough = current.totals.visitors >= INSIGHTS_MIN_VISITORS;
  const comparable = enough && previous !== null && previous.totals.visitors >= INSIGHTS_MIN_VISITORS;
  const sample: InsightsSample = { enough, visitors: current.totals.visitors, minimum: INSIGHTS_MIN_VISITORS, comparable };

  const metrics = periodMetrics(current);
  const digest = {
    periodo: current.range,
    muestraSuficiente: enough,
    metricas: metrics,
    ...(comparable && previous
      ? {
          periodoAnterior: previous.range,
          metricasAnteriores: periodMetrics(previous),
          variacionPorcentual: {
            visitantes: change(current.totals.visitors, previous.totals.visitors),
            clics: change(metrics.clics, previous.totals.blockClicks + previous.totals.whatsappClicks),
            leads: change(current.totals.leads, previous.totals.leads),
          },
        }
      : {}),
    // Solo con muestra: con 3 visitas, "el 66 % usa teléfono" no dice nada.
    ...(enough
      ? {
          dispositivos: current.devices.slice(0, 5).map((row) => ({ tipo: row.key, visitas: row.value })),
          fuentes: current.utmSources.slice(0, 5).map((row) => ({ fuente: row.key, visitas: row.value })),
          campanas: current.utmCampaigns.slice(0, 5).map((row) => ({ campana: row.key, visitas: row.value })),
          bloquesMasUsados: current.topBlocks
            .filter((row) => !row.deleted)
            .slice(0, 5)
            .map((row) => ({ tipo: row.kind, texto: row.label, clics: row.value })),
        }
      : {}),
    saludDePagina: health
      ? { puntaje: health.score, hallazgos: health.findings.map((finding) => ({ codigo: finding.code, severidad: finding.severity, bloque: finding.blockType ?? null })) }
      : null,
  };
  return { digest, sample };
}

/**
 * Esquema de la salida del modelo. `findingCode` solo puede ser uno de los hallazgos que la página
 * tiene de verdad (o nulo): una acción no puede apuntar a un problema inventado.
 */
export function insightsOutputSchema(findingCodes: string[]) {
  const unique = [...new Set(findingCodes)];
  const finding = unique.length > 0 ? z.enum(unique as [string, ...string[]]).nullable() : z.null();
  return z.object({
    summary: z.string().trim().min(1).max(600),
    actions: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(90),
          reason: z.string().trim().min(1).max(300),
          kind: z.enum(AI_INSIGHT_ACTION_KINDS),
          findingCode: finding,
        }),
      )
      .min(1)
      .max(3),
  });
}
