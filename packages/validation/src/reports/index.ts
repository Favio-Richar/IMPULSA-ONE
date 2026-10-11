import { z } from "zod";
import { toCsv } from "../agency/import-csv.js";

/**
 * Informe por cliente (F9.8, ADR-028 §6). Todo lo que decide fechas y comparaciones es puro y se prueba con valores conocidos: el servidor
 * solo aporta los números de la organización del cliente.
 */

const DAY_MS = 86_400_000;
export const REPORT_RANGE_MAX_DAYS = 366;

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, "Fecha inválida.");

export const reportQuerySchema = z
  .object({ from: dayString, to: dayString })
  .refine((value) => value.from <= value.to, { message: "La fecha inicial no puede ser posterior a la final.", path: ["to"] })
  .refine((value) => daysInRange(value.from, value.to) <= REPORT_RANGE_MAX_DAYS, {
    message: `El periodo no puede pasar de ${REPORT_RANGE_MAX_DAYS} días.`,
    path: ["to"],
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

function toTime(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function toDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Días que cubre el rango, ambos extremos incluidos. */
export function daysInRange(from: string, to: string): number {
  return Math.round((toTime(to) - toTime(from)) / DAY_MS) + 1;
}

export interface ReportPeriod {
  from: string;
  to: string;
}

/** El periodo inmediatamente anterior, de la misma duración (7 días → los 7 días previos). */
export function previousPeriod(period: ReportPeriod): ReportPeriod {
  const length = daysInRange(period.from, period.to);
  return { from: toDay(toTime(period.from) - length * DAY_MS), to: toDay(toTime(period.from) - DAY_MS) };
}

/** El mismo periodo del año anterior (mismas fechas, un año antes; el 29 de febrero cae al 28). */
export function sameWindowLastYear(period: ReportPeriod): ReportPeriod {
  const shift = (day: string): string => {
    const [year, month, date] = day.split("-").map(Number) as [number, number, number];
    const candidate = new Date(Date.UTC(year - 1, month - 1, date));
    // 29-feb de un año bisiesto no existe el año anterior: Date lo corre al 1-mar; se vuelve al 28-feb.
    if (candidate.getUTCMonth() !== month - 1) return toDay(Date.UTC(year - 1, month - 1, 28));
    return toDay(candidate.getTime());
  };
  return { from: shift(period.from), to: shift(period.to) };
}

export interface Delta {
  /** Valor del periodo comparado, o `null` si no hay datos de ese periodo. */
  base: number | null;
  /** `actual − base`, o `null` sin base. */
  change: number | null;
  /** `(actual − base) / base`, o `null` si la base es 0 o no hay (no se inventa un «∞ %»). */
  ratio: number | null;
}

/** Compara un valor con su base. Sin base (o base 0) la variación relativa es `null`, nunca infinita ni 0 % engañoso. */
export function compareValue(current: number | null, base: number | null): Delta {
  if (current === null || base === null) return { base, change: null, ratio: null };
  return { base, change: current - base, ratio: base === 0 ? null : (current - base) / base };
}

/** Las métricas del informe y cómo se llaman. El orden es el de la tabla y el del CSV. */
export const REPORT_METRICS = [
  { key: "pageViews", label: "Visitas" },
  { key: "visitors", label: "Visitantes (suma por día)" },
  { key: "blockClicks", label: "Clics en bloques" },
  { key: "whatsappClicks", label: "Clics en WhatsApp" },
  { key: "leads", label: "Contactos por formulario" },
  { key: "newContacts", label: "Contactos nuevos" },
  { key: "bookings", label: "Reservas" },
  { key: "orders", label: "Pedidos" },
  { key: "revenue", label: "Ventas pagadas" },
] as const;
export type ReportMetricKey = (typeof REPORT_METRICS)[number]["key"];

export type ReportTotals = Record<ReportMetricKey, number>;

/** `leads / visitors`, o `null` sin visitantes. */
export function conversionRate(totals: Pick<ReportTotals, "leads" | "visitors">): number | null {
  return totals.visitors > 0 ? totals.leads / totals.visitors : null;
}

export interface ComparedMetric {
  key: ReportMetricKey;
  label: string;
  value: number;
  previous: Delta;
  lastYear: Delta;
}

/** Cada métrica del periodo con su comparación contra el periodo anterior y contra el mismo periodo del año anterior. */
export function compareTotals(current: ReportTotals, previous: ReportTotals | null, lastYear: ReportTotals | null): ComparedMetric[] {
  return REPORT_METRICS.map(({ key, label }) => ({
    key,
    label,
    value: current[key],
    previous: compareValue(current[key], previous ? previous[key] : null),
    lastYear: compareValue(current[key], lastYear ? lastYear[key] : null),
  }));
}

export interface ReportCsvInput {
  organizationName: string;
  period: ReportPeriod;
  previousPeriod: ReportPeriod;
  lastYearPeriod: ReportPeriod;
  metrics: ComparedMetric[];
  conversion: { value: number | null; previous: number | null; lastYear: number | null };
  topBlocks: Array<{ label: string; detail: string | null; value: number }>;
}

const percent = (ratio: number | null): string => (ratio === null ? "" : `${(ratio * 100).toFixed(1)} %`);

/**
 * CSV del informe. Todo lo que sale pasa por `toCsv`/`csvCell`: un nombre de bloque o de organización que empiece por `=`, `+`, `-` o `@` no
 * se ejecuta como fórmula en una hoja de cálculo. Lleva solo cifras agregadas, nunca datos personales de contactos.
 */
export function reportCsv(input: ReportCsvInput): string {
  const rows: Array<Array<string | number | null>> = [
    ["Informe", input.organizationName],
    ["Periodo", `${input.period.from} a ${input.period.to}`],
    ["Periodo anterior", `${input.previousPeriod.from} a ${input.previousPeriod.to}`],
    ["Mismo periodo del año anterior", `${input.lastYearPeriod.from} a ${input.lastYearPeriod.to}`],
    [],
    ["Métrica", "Valor", "Periodo anterior", "Variación", "Variación %", "Año anterior", "Variación", "Variación %"],
    ...input.metrics.map((metric) => [
      metric.label,
      metric.value,
      metric.previous.base,
      metric.previous.change,
      percent(metric.previous.ratio),
      metric.lastYear.base,
      metric.lastYear.change,
      percent(metric.lastYear.ratio),
    ]),
    [
      "Conversión (contactos / visitantes)",
      percent(input.conversion.value),
      percent(input.conversion.previous),
      "",
      "",
      percent(input.conversion.lastYear),
      "",
      "",
    ],
    [],
    ["Bloques con más clics", "Página", "Clics"],
    ...input.topBlocks.map((block) => [block.label, block.detail ?? "", block.value]),
  ];
  return toCsv(rows);
}
