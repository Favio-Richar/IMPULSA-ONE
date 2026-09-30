// Reintentos, desactivación y retención de los webhooks (ADR-017 §3–4).

/** Espera antes de cada reintento (el intento 1 es el envío inicial). ~1 día en total. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 12 * 3_600_000] as const;
/** Intentos totales de una entrega. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Fallas seguidas (entregas agotadas) que desactivan un destino y avisan al dueño. */
export const CONSECUTIVE_FAILURES_TO_DISABLE = 15;
/** Las entregas guardan datos personales: se borran pasado este plazo (ADR-004). */
export const DELIVERY_RETENTION_DAYS = 30;

/** Espera antes del intento `nextAttempt` (2, 3, …), o `null` si ya no quedan. */
export function retryDelayMs(nextAttempt: number): number | null {
  if (nextAttempt < 2 || nextAttempt > MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[nextAttempt - 2] ?? null;
}

/**
 * ¿Vale la pena reintentar? `410 Gone` es "este destino ya no existe": se desactiva sin más
 * intentos. Otro 4xx (salvo 408 y 429) es un error del receptor que un reintento no arregla, pero
 * igual se reintenta: el negocio puede estar corrigiendo su configuración (ej. Zapier con el Zap
 * apagado responde 4xx un rato).
 */
export function isGone(status: number | null): boolean {
  return status === 410;
}
