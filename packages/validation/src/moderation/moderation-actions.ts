import { z } from "zod";
import { cleanPlainText } from "./abuse-report.js";

/**
 * Acciones de moderación (F9.9b, ADR-028 §7). Una sola tabla de transiciones, pura y probada aparte: el servidor la
 * aplica con una actualización condicional y la interfaz de administración la usa para mostrar solo lo que procede.
 *
 * Todas las medidas son reversibles (`restore`) y llevan un motivo escrito, que queda en la auditoría y es el que
 * ve el propietario del sitio.
 */
export const ABUSE_REPORT_STATUSES = ["OPEN", "DISMISSED", "WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED", "APPEALED"] as const;
export type AbuseReportStatusValue = (typeof ABUSE_REPORT_STATUSES)[number];

export const MODERATION_ACTIONS = ["dismiss", "warn", "unpublish", "suspend", "restore", "uphold"] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const MODERATION_ACTION_LABELS: Record<ModerationAction, string> = {
  dismiss: "Descartar",
  warn: "Advertir al propietario",
  unpublish: "Despublicar el sitio",
  suspend: "Suspender la organización",
  restore: "Restaurar",
  uphold: "Mantener la medida",
};

/** Medidas vigentes sobre el negocio: son las únicas que el propietario puede apelar y las únicas que se pueden restaurar. */
export const MEASURE_STATUSES = ["WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED"] as const;
export type MeasureStatus = (typeof MEASURE_STATUSES)[number];

export function isMeasure(status: AbuseReportStatusValue | null | undefined): status is MeasureStatus {
  return status !== null && status !== undefined && (MEASURE_STATUSES as readonly string[]).includes(status);
}

// Tabla sobre el estado EFECTIVO: durante una apelación la medida sigue vigente, así que se decide como si el caso
// siguiera en el estado que tenía al apelar (`statusBeforeAppeal`). `uphold` es la única acción propia de la apelación.
const TRANSITIONS: Record<Exclude<ModerationAction, "uphold">, { from: readonly AbuseReportStatusValue[]; to: AbuseReportStatusValue }> = {
  dismiss: { from: ["OPEN", "WARNED"], to: "DISMISSED" },
  warn: { from: ["OPEN"], to: "WARNED" },
  unpublish: { from: ["OPEN", "WARNED"], to: "SITE_UNPUBLISHED" },
  suspend: { from: ["OPEN", "WARNED", "SITE_UNPUBLISHED"], to: "ORG_SUSPENDED" },
  // Deshacer la medida vigente (o una advertencia): el caso queda cerrado como descartado.
  restore: { from: ["WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED"], to: "DISMISSED" },
};

/** Estado sobre el que se decide: el de antes de la apelación mientras esta siga abierta. */
export function effectiveStatus(status: AbuseReportStatusValue, statusBeforeAppeal: AbuseReportStatusValue | null | undefined): AbuseReportStatusValue {
  return status === "APPEALED" ? (statusBeforeAppeal ?? "OPEN") : status;
}

export function moderationTransition(
  status: AbuseReportStatusValue,
  action: ModerationAction,
  statusBeforeAppeal?: AbuseReportStatusValue | null,
): AbuseReportStatusValue | null {
  if (action === "uphold") {
    return status === "APPEALED" && isMeasure(statusBeforeAppeal) ? statusBeforeAppeal : null;
  }
  const rule = TRANSITIONS[action];
  return rule.from.includes(effectiveStatus(status, statusBeforeAppeal)) ? rule.to : null;
}

export function availableModerationActions(status: AbuseReportStatusValue, statusBeforeAppeal?: AbuseReportStatusValue | null): ModerationAction[] {
  return MODERATION_ACTIONS.filter((action) => moderationTransition(status, action, statusBeforeAppeal) !== null);
}

/** El propietario apela una sola vez cada decisión, y solo mientras haya una medida vigente. */
export function canAppeal(status: AbuseReportStatusValue, appealedAt: Date | string | null | undefined): boolean {
  return isMeasure(status) && !appealedAt;
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

export const APPEAL_TEXT_MIN = 20;
export const APPEAL_TEXT_MAX = 1000;

/** Apelación del propietario: texto plano, saneado igual que el reporte (sin controles ni direccionales). */
export const createAppealSchema = z
  .object({
    text: z
      .string()
      .max(APPEAL_TEXT_MAX * 2, "Texto demasiado largo.")
      .transform(cleanPlainText)
      .pipe(
        z
          .string()
          .min(APPEAL_TEXT_MIN, `Cuéntanos por qué la medida no corresponde (al menos ${APPEAL_TEXT_MIN} caracteres).`)
          .max(APPEAL_TEXT_MAX, `Máximo ${APPEAL_TEXT_MAX} caracteres.`),
      ),
  })
  .strict();
export type CreateAppealDto = z.infer<typeof createAppealSchema>;
