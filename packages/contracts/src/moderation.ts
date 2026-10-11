import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Moderación y reportes de abuso (F9.9, ADR-028 §7).

/** Respuesta del reporte público. Idéntica exista o no un reporte previo del mismo visitante: no se le dice nada que sirva para sondear. */
export const abuseReportAckResponse = z.object({
  received: z.literal(true),
});

export const abuseReportReasonResponse = z.enum(["SPAM", "IMPERSONATION", "ILLEGAL_CONTENT", "FRAUD", "OTHER"]);
export const abuseReportStatusResponse = z.enum(["OPEN", "DISMISSED", "WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED", "APPEALED"]);
export const moderationActionResponse = z.enum(["dismiss", "warn", "unpublish", "suspend", "restore", "uphold"]);

/** Lo que ve el equipo de superadministración. El correo del denunciante solo aparece acá, nunca en lo que ve el propietario. */
export const adminAbuseReportResponse = z.object({
  id: uuid,
  reason: abuseReportReasonResponse,
  details: z.string().nullable(),
  reporterEmail: z.string().nullable(),
  status: abuseReportStatusResponse,
  resolution: z.string().nullable(),
  appealText: z.string().nullable(),
  appealedAt: isoDateTime.nullable(),
  /** Medida vigente mientras la apelación está abierta (el estado que tenía el caso al apelar). */
  appealedFrom: abuseReportStatusResponse.nullable(),
  resolvedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  site: z.object({ id: uuid, name: z.string(), slug: z.string(), hidden: z.boolean() }),
  organization: z.object({ id: uuid, name: z.string(), blocked: z.boolean() }),
  /** Reportes abiertos o apelados de este mismo sitio: la prioridad de la cola. */
  siteOpenReports: z.number().int(),
  /** Acciones que proceden desde el estado actual. */
  availableActions: z.array(moderationActionResponse),
});

export const adminAbuseReportListResponse = z.object({
  items: z.array(adminAbuseReportResponse),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Casos que esperan decisión (abiertos y apelados), con independencia del filtro. */
  queueSize: z.number().int(),
});

export const adminAbuseReportHistoryEntry = z.object({
  id: uuid,
  action: z.string(),
  actorEmail: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: isoDateTime,
});

export const adminAbuseReportDetailResponse = adminAbuseReportResponse.extend({
  history: z.array(adminAbuseReportHistoryEntry),
});

/**
 * Lo que ve el PROPIETARIO sobre una medida de moderación (F9.9c). A propósito no incluye el texto del reporte, el correo ni
 * ningún dato de quien denunció, ni quién del equipo decidió: solo el motivo de la categoría, la medida y la explicación.
 */
export const moderationCaseResponse = z.object({
  id: uuid,
  reason: abuseReportReasonResponse,
  /** Estado del caso: la medida vigente, `APPEALED` mientras se revisa, o `DISMISSED` si la apelación prosperó. */
  status: abuseReportStatusResponse,
  /** Medida que rige hoy sobre el negocio (`null` si ya no hay ninguna). */
  measure: z.enum(["WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED"]).nullable(),
  /** Explicación escrita por el equipo al decidir. */
  statement: z.string().nullable(),
  site: z.object({ id: uuid, name: z.string() }),
  decidedAt: isoDateTime.nullable(),
  canAppeal: z.boolean(),
  appealText: z.string().nullable(),
  appealedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const moderationCaseListResponse = z.array(moderationCaseResponse);

export type ModerationCaseResponse = z.infer<typeof moderationCaseResponse>;
export type AbuseReportAckResponse = z.infer<typeof abuseReportAckResponse>;
export type AdminAbuseReportResponse = z.infer<typeof adminAbuseReportResponse>;
export type AdminAbuseReportListResponse = z.infer<typeof adminAbuseReportListResponse>;
export type AdminAbuseReportDetailResponse = z.infer<typeof adminAbuseReportDetailResponse>;
