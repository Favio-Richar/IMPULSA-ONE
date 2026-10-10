import { z } from "zod";

/**
 * Aprobación antes de publicar (F9.6c, ADR-028 §3). Las reglas son funciones puras: la API las aplica en cada petición y sus pruebas
 * recorren cada combinación. Una solicitud guarda el contenido exacto que se pide publicar; aprobarla es aprobar ESE contenido.
 */

export const PUBLISH_REQUEST_KINDS = ["PUBLISH", "RESTORE"] as const;
export type PublishRequestKindValue = (typeof PUBLISH_REQUEST_KINDS)[number];

export const PUBLISH_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type PublishRequestStatusValue = (typeof PUBLISH_REQUEST_STATUSES)[number];

export const PUBLISH_COMMENT_MAX = 500;

const commentSchema = z
  .string()
  .trim()
  .max(PUBLISH_COMMENT_MAX, `Máximo ${PUBLISH_COMMENT_MAX} caracteres.`)
  .nullish()
  .transform((value) => (value ? value : null));

/** Pedir publicar el contenido vivo (`PUBLISH`) o volver a una versión del historial (`RESTORE`, con `versionId`). */
export const createPublishRequestSchema = z
  .object({
    kind: z.enum(PUBLISH_REQUEST_KINDS).default("PUBLISH"),
    versionId: z.uuid().nullish(),
    comment: commentSchema,
  })
  .superRefine((value, ctx) => {
    if (value.kind === "RESTORE" && !value.versionId) {
      ctx.addIssue({ code: "custom", path: ["versionId"], message: "Indica la versión a la que se quiere volver." });
    }
    if (value.kind === "PUBLISH" && value.versionId) {
      ctx.addIssue({ code: "custom", path: ["versionId"], message: "Publicar el contenido actual no lleva versión." });
    }
  })
  .transform((value) => ({ kind: value.kind, versionId: value.versionId ?? null, comment: value.comment }));
export type CreatePublishRequestDto = z.infer<typeof createPublishRequestSchema>;

export const approvePublishRequestSchema = z.object({ comment: commentSchema });
export type ApprovePublishRequestDto = z.infer<typeof approvePublishRequestSchema>;

/** Rechazar exige explicar por qué: quien pidió necesita saber qué corregir. */
export const rejectPublishRequestSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(3, "Explica brevemente el motivo.")
    .max(PUBLISH_COMMENT_MAX, `Máximo ${PUBLISH_COMMENT_MAX} caracteres.`),
});
export type RejectPublishRequestDto = z.infer<typeof rejectPublishRequestSchema>;

export const publishSettingsSchema = z.object({ requireApproval: z.boolean() });
export type PublishSettingsDto = z.infer<typeof publishSettingsSchema>;

export const publishRequestListQuerySchema = z.object({
  status: z.enum(PUBLISH_REQUEST_STATUSES).optional(),
  pageId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type PublishRequestListQuery = z.infer<typeof publishRequestListQuerySchema>;

export type PublishGate =
  | { mode: "DIRECT" }
  | { mode: "NEEDS_APPROVAL" };

/**
 * ¿Publica directo o necesita una aprobación? Directo si la organización no la exige, o si quien actúa puede aprobar (`publish.approve`):
 * quien puede aprobar a otros no se pide permiso a sí mismo, y de todos modos nadie aprueba su propia solicitud.
 */
export function publishGate(input: { requireApproval: boolean; actorCanApprove: boolean }): PublishGate {
  if (!input.requireApproval || input.actorCanApprove) return { mode: "DIRECT" };
  return { mode: "NEEDS_APPROVAL" };
}

export type ReviewVerdict =
  | { allowed: true }
  | { allowed: false; code: "SELF_REVIEW" | "NOT_PENDING"; message: string };

/** ¿Puede `actorId` aprobar o rechazar la solicitud? Nunca la propia, y solo mientras esté pendiente. */
export function reviewVerdict(input: { actorId: string; requestedById: string | null; status: PublishRequestStatusValue }): ReviewVerdict {
  if (input.status !== "PENDING") {
    return { allowed: false, code: "NOT_PENDING", message: "Esta solicitud ya fue resuelta." };
  }
  if (input.requestedById !== null && input.requestedById === input.actorId) {
    return { allowed: false, code: "SELF_REVIEW", message: "No puedes aprobar ni rechazar tu propia solicitud: lo hace otra persona con ese permiso." };
  }
  return { allowed: true };
}
