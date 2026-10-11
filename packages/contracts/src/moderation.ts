import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Moderación y reportes de abuso (F9.9, ADR-028 §7).

/** Respuesta del reporte público. Idéntica exista o no un reporte previo del mismo visitante: no se le dice nada que sirva para sondear. */
export const abuseReportAckResponse = z.object({
  received: z.literal(true),
});

export const abuseReportReasonResponse = z.enum(["SPAM", "IMPERSONATION", "ILLEGAL_CONTENT", "FRAUD", "OTHER"]);
export const abuseReportStatusResponse = z.enum(["OPEN", "DISMISSED", "WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED", "APPEALED"]);
export const moderationActionResponse = z.enum(["dismiss", "warn", "unpublish", "suspend", "restore"]);

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

export type AbuseReportAckResponse = z.infer<typeof abuseReportAckResponse>;
export type AdminAbuseReportResponse = z.infer<typeof adminAbuseReportResponse>;
export type AdminAbuseReportListResponse = z.infer<typeof adminAbuseReportListResponse>;
export type AdminAbuseReportDetailResponse = z.infer<typeof adminAbuseReportDetailResponse>;
