import { z } from "zod";
import { PUBLISH_REQUEST_KINDS, PUBLISH_REQUEST_STATUSES } from "@impulza/validation";
import { isoDateTime, uuid } from "./primitives.js";

// ---- aprobación antes de publicar (F9.6c, ADR-028 §3) ----------------------------------------------------------------
// Los cuerpos de petición viven en `@impulza/validation` (`publish/`).

const person = z.object({ id: uuid, email: z.string() }).nullable();

export const publishRequestSummaryResponse = z.object({
  id: uuid,
  pageId: uuid,
  pageSlug: z.string(),
  siteId: uuid,
  siteName: z.string(),
  kind: z.enum(PUBLISH_REQUEST_KINDS),
  /** Solo en `RESTORE`: el número de la versión del historial a la que se pide volver. */
  targetVersionNumber: z.number().int().nullable(),
  status: z.enum(PUBLISH_REQUEST_STATUSES),
  requestedBy: person,
  requestComment: z.string().nullable(),
  reviewedBy: person,
  reviewComment: z.string().nullable(),
  reviewedAt: isoDateTime.nullable(),
  /** Cuándo se usó la aprobación para publicar (una aprobación se usa una sola vez). */
  consumedAt: isoDateTime.nullable(),
  publishedVersionNumber: z.number().int().nullable(),
  createdAt: isoDateTime,
});

/** El contenido que se pidió publicar, para que quien aprueba vea exactamente lo que está aprobando. */
export const publishRequestContentResponse = z.object({
  slug: z.string(),
  visibility: z.enum(["PUBLIC", "HIDDEN"]),
  seoMeta: z.unknown().nullable(),
  blocks: z.array(z.object({ type: z.string(), position: z.number().int(), visible: z.boolean(), config: z.unknown() })),
});

export const publishRequestDetailResponse = publishRequestSummaryResponse.extend({
  content: publishRequestContentResponse,
  /** `true` si el contenido vivo de la página sigue siendo el de la solicitud (solo en `PUBLISH`; `null` si no aplica). */
  contentIsCurrent: z.boolean().nullable(),
});

export const publishRequestListResponse = z.object({
  items: z.array(publishRequestSummaryResponse),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export const pagePublishStatusResponse = z.object({
  /** La organización exige aprobación para publicar. */
  approvalRequired: z.boolean(),
  /** Quien consulta puede publicar sin pedir aprobación (no se exige, o tiene `publish.approve`). */
  canPublishDirectly: z.boolean(),
  canApprove: z.boolean(),
  /** La solicitud pendiente de la página (como mucho una). */
  pending: publishRequestSummaryResponse.nullable(),
  /** Aprobaciones sin usar que hoy sirven para publicar o restaurar. */
  approved: z.array(publishRequestSummaryResponse),
  /** La última solicitud resuelta (aprobada, rechazada o cancelada), para mostrar el motivo de un rechazo. */
  lastResolved: publishRequestSummaryResponse.nullable(),
});

export const publishSettingsResponse = z.object({
  requireApproval: z.boolean(),
  /** Quien consulta puede cambiar la opción (`publish.configure`); el servidor lo vuelve a comprobar. */
  canConfigure: z.boolean(),
  /** Quien consulta puede aprobar o rechazar solicitudes (`publish.approve`). */
  canApprove: z.boolean(),
});

export const publishRequestCommentResponse = z.object({
  id: uuid,
  body: z.string(),
  author: person,
  createdAt: isoDateTime,
});
export const publishRequestCommentsResponse = z.array(publishRequestCommentResponse);
export type PublishRequestCommentResponse = z.infer<typeof publishRequestCommentResponse>;

export type PublishRequestSummaryResponse = z.infer<typeof publishRequestSummaryResponse>;
export type PublishRequestDetailResponse = z.infer<typeof publishRequestDetailResponse>;
export type PublishRequestListResponse = z.infer<typeof publishRequestListResponse>;
export type PagePublishStatusResponse = z.infer<typeof pagePublishStatusResponse>;
export type PublishSettingsResponse = z.infer<typeof publishSettingsResponse>;
