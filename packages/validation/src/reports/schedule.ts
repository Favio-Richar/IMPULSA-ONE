import { z } from "zod";
import type { ReportPeriod } from "./index.js";

/**
 * Informes programados (F9.8c, ADR-028 §6). Cuándo corre una programación y qué periodo cubre son funciones puras en UTC: el mismo
 * instante programado da siempre el mismo periodo, así que una ejecución repetida o atrasada es la misma ejecución (idempotencia).
 */

export const REPORT_SCHEDULE_FREQUENCIES = ["WEEKLY", "MONTHLY"] as const;
export type ReportScheduleFrequency = (typeof REPORT_SCHEDULE_FREQUENCIES)[number];

export const REPORT_SCHEDULE_FREQUENCY_LABELS: Record<ReportScheduleFrequency, string> = {
  WEEKLY: "Cada semana (lunes)",
  MONTHLY: "Cada mes (día 1)",
};

/** Hora UTC en que corre una programación. */
export const REPORT_SCHEDULE_HOUR_UTC = 8;
export const REPORT_RECIPIENTS_MAX = 5;
export const REPORT_SCHEDULES_PER_ORGANIZATION_MAX = 5;

const recipientsSchema = z
  .array(z.string().trim().toLowerCase().pipe(z.email("Correo inválido.").max(254)))
  .min(1, "Agrega al menos un destinatario.")
  .max(REPORT_RECIPIENTS_MAX, `Hasta ${REPORT_RECIPIENTS_MAX} destinatarios.`)
  .transform((emails) => [...new Set(emails)]);

const labelSchema = z.string().trim().max(80, "Máximo 80 caracteres.").nullish().transform((value) => (value ? value : null));

export const createReportScheduleSchema = z.object({
  frequency: z.enum(REPORT_SCHEDULE_FREQUENCIES),
  recipients: recipientsSchema,
  label: labelSchema,
});
export type CreateReportScheduleDto = z.infer<typeof createReportScheduleSchema>;

export const updateReportScheduleSchema = z
  .object({ enabled: z.boolean().optional(), recipients: recipientsSchema.optional(), label: labelSchema.optional() })
  .refine((value) => value.enabled !== undefined || value.recipients !== undefined || value.label !== undefined, { message: "No hay nada que cambiar." });
export type UpdateReportScheduleDto = z.infer<typeof updateReportScheduleSchema>;

const DAY_MS = 86_400_000;

function utc(year: number, month: number, day: number, hour = REPORT_SCHEDULE_HOUR_UTC): Date {
  return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
}

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** El instante programado siguiente, estrictamente posterior a `from`: el próximo lunes (semanal) o el día 1 (mensual) a las 08:00 UTC. */
export function nextScheduledRun(frequency: ReportScheduleFrequency, from: Date): Date {
  if (frequency === "MONTHLY") {
    const thisMonth = utc(from.getUTCFullYear(), from.getUTCMonth(), 1);
    return thisMonth.getTime() > from.getTime() ? thisMonth : utc(from.getUTCFullYear(), from.getUTCMonth() + 1, 1);
  }
  const daysSinceMonday = (from.getUTCDay() + 6) % 7;
  const monday = utc(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - daysSinceMonday);
  return monday.getTime() > from.getTime() ? monday : new Date(monday.getTime() + 7 * DAY_MS);
}

/** La última ocurrencia programada que ya pasó (≤ `now`), a partir de una ocurrencia conocida anterior o igual a `now`. */
export function latestOccurrence(frequency: ReportScheduleFrequency, knownOccurrence: Date, now: Date): Date {
  let occurrence = knownOccurrence;
  // Cota de seguridad: más de 3 años de ocurrencias pendientes no tiene sentido (y evita un bucle ante datos corruptos).
  for (let guard = 0; guard < 200; guard += 1) {
    const next = nextScheduledRun(frequency, occurrence);
    if (next.getTime() > now.getTime()) break;
    occurrence = next;
  }
  return occurrence;
}

/**
 * El periodo que cubre la ejecución programada para `runAt`: la semana completa anterior (lunes a domingo) o el mes calendario anterior.
 * Depende solo de la fecha programada, nunca de cuándo se procesó: una ejecución atrasada cubre el mismo periodo.
 */
export function scheduledPeriod(frequency: ReportScheduleFrequency, runAt: Date): ReportPeriod {
  if (frequency === "MONTHLY") {
    const first = utc(runAt.getUTCFullYear(), runAt.getUTCMonth() - 1, 1, 0);
    const last = utc(runAt.getUTCFullYear(), runAt.getUTCMonth(), 0, 0);
    return { from: dayString(first), to: dayString(last) };
  }
  const daysSinceMonday = (runAt.getUTCDay() + 6) % 7;
  const thisMonday = utc(runAt.getUTCFullYear(), runAt.getUTCMonth(), runAt.getUTCDate() - daysSinceMonday, 0);
  return { from: dayString(new Date(thisMonday.getTime() - 7 * DAY_MS)), to: dayString(new Date(thisMonday.getTime() - DAY_MS)) };
}

/** Clave de idempotencia de una ejecución: una programación corre una vez por periodo. */
export function runKey(scheduleId: string, period: ReportPeriod): string {
  return `${scheduleId}:${period.from}`;
}
