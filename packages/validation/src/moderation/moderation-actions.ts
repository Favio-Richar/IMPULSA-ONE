import { z } from "zod";

/**
 * Acciones de moderación (F9.9b, ADR-028 §7). Una sola tabla de transiciones, pura y probada aparte: el servidor la
 * aplica con una actualización condicional y la interfaz de administración la usa para mostrar solo lo que procede.
 *
 * Todas las medidas son reversibles (`restore`) y llevan un motivo escrito, que queda en la auditoría y es el que
 * ve el propietario del sitio.
 */
export const ABUSE_REPORT_STATUSES = ["OPEN", "DISMISSED", "WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED", "APPEALED"] as const;
export type AbuseReportStatusValue = (typeof ABUSE_REPORT_STATUSES)[number];

export const MODERATION_ACTIONS = ["dismiss", "warn", "unpublish", "suspend", "restore"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const MODERATION_ACTION_LABELS: Record<ModerationAction, string> = {
  dismiss: "Descartar",
  warn: "Advertir al propietario",
  unpublish: "Despublicar el sitio",
  suspend: "Suspender la organización",
  restore: "Restaurar",
};

const TRANSITIONS: Record<ModerationAction, { from: readonly AbuseReportStatusValue[]; to: AbuseReportStatusValue }> = {
  dismiss: { from: ["OPEN", "APPEALED", "WARNED"], to: "DISMISSED" },
  warn: { from: ["OPEN", "APPEALED"], to: "WARNED" },
  unpublish: { from: ["OPEN", "APPEALED", "WARNED"], to: "SITE_UNPUBLISHED" },
  suspend: { from: ["OPEN", "APPEALED", "WARNED", "SITE_UNPUBLISHED"], to: "ORG_SUSPENDED" },
  // Deshacer la medida vigente (o una advertencia): el caso queda cerrado como descartado.
  restore: { from: ["WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED"], to: "DISMISSED" },
};

export function moderationTransition(status: AbuseReportStatusValue, action: ModerationAction): AbuseReportStatusValue | null {
  const rule = TRANSITIONS[action];
  return rule.from.includes(status) ? rule.to : null;
}

/** Estados desde los que `action` es válida: para el `WHERE` de la actualización condicional. */
export function statusesAllowing(action: ModerationAction): readonly AbuseReportStatusValue[] {
  return TRANSITIONS[action].from;
}

export function availableModerationActions(status: AbuseReportStatusValue): ModerationAction[] {
  return MODERATION_ACTIONS.filter((action) => moderationTransition(status, action) !== null);
}

/** Casos que esperan una decisión de una persona del equipo. */
export const QUEUE_STATUSES = ["OPEN", "APPEALED"] as const;

export const MODERATION_REASON_MIN = 5;
export const MODERATION_REASON_MAX = 500;

export const moderationActionSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(MODERATION_REASON_MIN, `Explica el motivo (al menos ${MODERATION_REASON_MIN} caracteres).`)
      .max(MODERATION_REASON_MAX, `Máximo ${MODERATION_REASON_MAX} caracteres.`),
  })
  .strict();
export type ModerationActionDto = z.infer<typeof moderationActionSchema>;

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);

export const listAbuseReportsQuerySchema = z.object({
  /** `QUEUE` = lo que espera decisión (abiertos y apelados); `ALL` = todo el historial. */
  status: z.enum(["QUEUE", "ALL", ...ABUSE_REPORT_STATUSES]).default("QUEUE"),
  reason: z.enum(["SPAM", "IMPERSONATION", "ILLEGAL_CONTENT", "FRAUD", "OTHER"]).optional(),
  siteId: z.uuid().optional(),
  organizationId: z.uuid().optional(),
  /** `priority`: los sitios con más reportes abiertos primero, y dentro de cada uno el más antiguo. */
  sort: z.enum(["priority", "oldest", "newest"]).default("priority"),
  page,
  pageSize,
});
export type ListAbuseReportsQueryDto = z.infer<typeof listAbuseReportsQuerySchema>;
