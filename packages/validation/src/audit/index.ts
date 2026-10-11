import { z } from "zod";

/**
 * Auditoría navegable (F9.6d, ADR-028 §3). Los filtros se validan aquí y los aplica el servidor; la exportación CSV sale por
 * `toCsv`/`csvCell` (nunca una celda que un programa de hojas de cálculo ejecute como fórmula).
 */

export const AUDIT_PAGE_SIZE_DEFAULT = 25;
export const AUDIT_PAGE_SIZE_MAX = 100;
/** Tope de filas de una exportación: más se acota con filtros (el CSV avisa que se cortó). */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
/** Rango máximo de fechas de una consulta: una auditoría de años enteros se pide por tramos. */
export const AUDIT_RANGE_MAX_DAYS = 366;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const dayString = z
  .string()
  .regex(DAY, "Usa el formato AAAA-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "Fecha inválida.");

const filters = {
  /** Fragmento del correo de quien actuó (sin distinguir mayúsculas). */
  actor: z.string().trim().max(100).optional(),
  /** Acción exacta o su prefijo: `publish_request` trae todas las de ese grupo. */
  action: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9_.]+$/, "Solo minúsculas, números, punto y guion bajo.")
    .optional(),
  /** Tipo de recurso afectado (`Page`, `PublishRequest`…). */
  targetType: z.string().trim().max(60).regex(/^[A-Za-z0-9_]+$/, "Solo letras, números y guion bajo.").optional(),
  from: dayString.optional(),
  to: dayString.optional(),
};

function rangeIsValid(value: { from?: string | undefined; to?: string | undefined }): boolean {
  if (value.from === undefined || value.to === undefined) return true;
  const span = (Date.parse(`${value.to}T00:00:00.000Z`) - Date.parse(`${value.from}T00:00:00.000Z`)) / 86_400_000;
  return span >= 0 && span <= AUDIT_RANGE_MAX_DAYS;
}

const RANGE_MESSAGE = `El rango debe ir de menor a mayor y no pasar de ${AUDIT_RANGE_MAX_DAYS} días.`;

/** Consulta de la auditoría de una organización (y, con `client`, de las acciones de una agencia en un cliente). */
export const auditQuerySchema = z
  .object({
    ...filters,
    /** Solo en la vista de agencia: la organización del cliente. */
    client: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(AUDIT_PAGE_SIZE_DEFAULT),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .refine(rangeIsValid, { message: RANGE_MESSAGE, path: ["to"] });
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** La exportación admite los mismos filtros pero no pagina. */
export const auditExportQuerySchema = z
  .object({ ...filters, client: z.uuid().optional() })
  .refine(rangeIsValid, { message: RANGE_MESSAGE, path: ["to"] });
export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;

/** `from` abarca todo el día (desde las 00:00 UTC) y `to` también (hasta el día siguiente, excluido). */
export function auditDateBounds(query: { from?: string | undefined; to?: string | undefined }): { gte?: Date; lt?: Date } {
  const bounds: { gte?: Date; lt?: Date } = {};
  if (query.from) bounds.gte = new Date(`${query.from}T00:00:00.000Z`);
  if (query.to) bounds.lt = new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 86_400_000);
  return bounds;
}

const METADATA_CELL_MAX = 1000;

/** El detalle de una entrada como texto para el CSV: JSON compacto y acotado (el recorte avisa con «…»). */
export function auditMetadataText(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return "";
  const text = JSON.stringify(metadata);
  return text.length > METADATA_CELL_MAX ? `${text.slice(0, METADATA_CELL_MAX)}…` : text;
}
