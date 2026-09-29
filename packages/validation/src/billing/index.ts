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
