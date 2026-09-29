import type { AnalyticsEventJob } from "./job.js";

// Claves de `AnalyticsAggregate.metric` (F3.6). Un evento incrementa varias a la vez: el total de
// su tipo más una por cada dimensión que el dashboard de conversión (F3.7, PM §9.12) necesita
// filtrar — así ninguna vista de uso frecuente tiene que escanear `AnalyticsEvent` crudo.
//
//   <tipo>                        total del día
//   <tipo>:visitors               visitantes únicos del día (el procesador decide si suma)
//   <tipo>:device:<mobile|...>    por tipo de dispositivo
//   <tipo>:country:<CL>           por país aproximado
//   <tipo>:utm_source:<valor>     por campaña (también utm_medium / utm_campaign)
//   <tipo>:subject:<uuid>         por objeto concreto (página, bloque, formulario, enlace, QR)
//   ab:<tipo>:<prueba>:<a|b>      por variante de una prueba A/B en curso (F6.5, ADR-011)

const MAX_DIMENSION_LENGTH = 80;

function dimensionValue(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, MAX_DIMENSION_LENGTH);
}

export function visitorsMetric(type: string): string {
  return `${type}:visitors`;
}

/** Todas las métricas que un evento incrementa, sin la de visitantes únicos (esa depende de si
 *  el visitante ya se vio hoy, cosa que solo sabe el procesador con la base a mano). */
export function metricsForEvent(job: AnalyticsEventJob): string[] {
  const metrics: string[] = [job.type];

  if (job.device) {
    metrics.push(`${job.type}:device:${job.device}`);
  }
  if (job.geoCountry) {
    metrics.push(`${job.type}:country:${job.geoCountry.toUpperCase()}`);
  }
  for (const key of ["source", "medium", "campaign"] as const) {
    const value = job.utm?.[key];
    if (value && value.trim().length > 0) {
      metrics.push(`${job.type}:utm_${key}:${dimensionValue(value)}`);
    }
  }
  if (job.subjectId) {
    metrics.push(`${job.type}:subject:${job.subjectId}`);
  }
  for (const experiment of job.experiments ?? []) {
    metrics.push(`ab:${job.type}:${experiment.testId}:${experiment.variant}`);
  }

  return metrics;
}

/** Período diario "YYYY-MM-DD" en UTC. UTC a propósito: el agregado no depende de la zona horaria
 *  del servidor que lo procesó, y el dashboard convierte al mostrar. */
export function periodFor(occurredAt: Date): string {
  return occurredAt.toISOString().slice(0, 10);
}
