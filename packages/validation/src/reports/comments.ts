import { z } from "zod";

/**
 * Comentarios del informe (F9.8d, ADR-028 §6): la agencia o el equipo anota sobre el informe de un periodo y el cliente responde desde su
 * portal. El hilo se identifica por organización + periodo; el cuerpo es texto plano (nunca HTML).
 */
export const REPORT_COMMENT_BODY_MAX = 1000;
/** Comentarios por periodo: un hilo no necesita cientos, y acota lo que una cuenta comprometida podría escribir. */
export const REPORT_COMMENTS_PER_PERIOD_MAX = 100;

export const createReportCommentSchema = z.object({
  body: z.string().trim().min(1, "Escribe un comentario.").max(REPORT_COMMENT_BODY_MAX, `Máximo ${REPORT_COMMENT_BODY_MAX} caracteres.`),
});
export type CreateReportCommentDto = z.infer<typeof createReportCommentSchema>;
