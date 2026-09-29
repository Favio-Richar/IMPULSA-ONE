import type { AnalyticsEventType, DeviceType, UtmParams } from "./taxonomy.js";

/** Nombre de la cola BullMQ del pipeline de ingesta (ST §10): endpoint → rate limit → esta cola →
 *  worker → `AnalyticsAggregate`. */
export const ANALYTICS_EVENTS_QUEUE = "analytics-events";

/** Cola de mantenimiento: por ahora solo la purga por retención (ADR-004 punto 4). Separada de la
 *  de eventos para que un borrado masivo nunca frene la ingesta. */
export const ANALYTICS_MAINTENANCE_QUEUE = "analytics-maintenance";
export const RETENTION_PURGE_JOB = "retention-purge";
/** Revisión de retención de contactos (ADR-004 punto 4): marca, no borra. */
export const CONTACT_RETENTION_REVIEW_JOB = "contact-retention-review";

/**
 * Lo que viaja por la cola. Ya viene minimizado desde la API: el visitante es un hash rotado por
 * día, el dispositivo una categoría y la geo solo país/ciudad — la IP y el user-agent crudos
 * nunca entran a Redis (ADR-004 punto 1).
 */
export interface AnalyticsEventJob {
  organizationId: string;
  siteId: string | null;
  type: AnalyticsEventType;
  anonymizedVisitorId: string | null;
  device: DeviceType | null;
  geoCountry: string | null;
  geoCity: string | null;
  utm: UtmParams | null;
  /** Página, bloque, formulario, enlace corto o QR al que se refiere el evento. */
  subjectId: string | null;
  /** Solo en eventos críticos (envío de formulario, lead, clic del navegador con id propio). */
  idempotencyKey: string | null;
  occurredAt: string;
  /**
   * Pruebas A/B en curso a las que cuenta este evento, con la variante que vio el visitante (F6.5,
   * ADR-011). La calcula la API a partir del grupo del visitante, nunca la declara el navegador.
   * Opcional: un trabajo encolado antes de F6.5 no lo trae.
   */
  experiments?: Array<{ testId: string; variant: "a" | "b" }>;
}
