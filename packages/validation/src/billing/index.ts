import { z } from "zod";

// Contratación de planes de pago (F4.6, ADR-012). Lo que manda el panel al pedir pagar un plan.

/** Versión vigente de los Términos del servicio y del aviso de retracto. Cambiarla obliga a volver
 *  a aceptar en la próxima contratación; la aceptación guardada dice qué versión se aceptó. */
export const LEGAL_DOCUMENT_VERSIONS = {
  terms: "2026-09-29",
  withdrawal_notice: "2026-09-29",
} as const;

export const billingGatewaySchema = z.enum(["WEBPAY_ONECLICK", "MERCADO_PAGO"]);
export const billingCycleSchema = z.enum(["MONTHLY", "YEARLY"]);

export const startCheckoutSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
  cycle: billingCycleSchema,
  gateway: billingGatewaySchema,
  /** Las dos casillas son obligatorias (Ley 19.496 art. 3 bis b: informar el retracto antes de
   *  contratar y pagar). `true` literal: un `false` o la ausencia se rechaza en el servidor. */
  acceptTerms: z.literal(true),
  acceptWithdrawalNotice: z.literal(true),
});

export type StartCheckoutInput = z.infer<typeof startCheckoutSchema>;

// ── Superadministración (F4.6d) ────────────────────────────────────────────────────────────────

/** Mes contable `YYYY-MM` (hora de Chile). */
export const billingMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Usa el formato AAAA-MM");

export const listAdminPaymentsQuerySchema = z.object({
  month: billingMonthSchema.optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "REFUNDED"]).optional(),
  taxDocument: z.enum(["PENDING", "ISSUED", "NOT_REQUIRED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Folio de la boleta o factura electrónica emitida ante el SII. */
export const markTaxDocumentSchema = z.object({
  documentNumber: z.string().trim().regex(/^\d{1,12}$/, "El folio son solo dígitos (hasta 12)"),
});

export const adminRefundSchema = z.object({
  /** Obligatorio: queda en la auditoría (mismo criterio que bloquear una organización). */
  reason: z.string().trim().min(10, "Explica el motivo (al menos 10 caracteres)").max(500),
});

export type ListAdminPaymentsQuery = z.infer<typeof listAdminPaymentsQuerySchema>;
export type MarkTaxDocumentInput = z.infer<typeof markTaxDocumentSchema>;
export type AdminRefundInput = z.infer<typeof adminRefundSchema>;
