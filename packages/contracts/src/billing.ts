import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Suscripción de pago y cobros (F4.6, ADR-012). Nunca datos de tarjeta más allá de marca y
// últimos 4 dígitos, ni referencias de la pasarela.

const gateway = z.enum(["WEBPAY_ONECLICK", "MERCADO_PAGO"]);
const cycle = z.enum(["MONTHLY", "YEARLY"]);

export const billingSubscriptionResponse = z.object({
  id: uuid,
  planCode: z.string(),
  planName: z.string(),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "INCOMPLETE"]),
  gateway: gateway.nullable(),
  cycle,
  /** Precio del ciclo en pesos, IVA incluido. */
  amount: z.number().int(),
  currency: z.string(),
  currentPeriodStart: isoDateTime,
  currentPeriodEnd: isoDateTime,
  /** Cancelada: sigue vigente hasta `currentPeriodEnd` y no se vuelve a cobrar. */
  cancelAtPeriodEnd: z.boolean(),
  /** Próximo cobro o reintento; `null` si no habrá (cancelada). */
  nextChargeAt: isoDateTime.nullable(),
  card: z.object({ brand: z.string().nullable(), last4: z.string().nullable() }).nullable(),
  /** Hasta cuándo se puede cancelar con reembolso total (retracto, 10 días desde el primer cobro). */
  withdrawalUntil: isoDateTime.nullable(),
});

export const billingPaymentResponse = z.object({
  id: uuid,
  amount: z.number().int(),
  netAmount: z.number().int(),
  vatAmount: z.number().int(),
  currency: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "REFUNDED"]),
  periodStart: isoDateTime,
  periodEnd: isoDateTime,
  paidAt: isoDateTime.nullable(),
  refundedAmount: z.number().int(),
  createdAt: isoDateTime,
});

export const billingOverviewResponse = z.object({
  /** Suscripción con derecho, o la última cancelada; `null` si nunca pagó. */
  subscription: billingSubscriptionResponse.nullable(),
  /** Pasarelas configuradas en este ambiente: el panel solo ofrece estas. */
  gateways: z.array(gateway),
  payments: z.array(billingPaymentResponse),
  /** Si quien pregunta puede contratar, cancelar o pedir el retracto (`billing.manage`). Lo decide
   *  el servidor; el panel solo muestra u oculta los botones. */
  canManage: z.boolean(),
  legal: z.object({ termsVersion: z.string(), withdrawalNoticeVersion: z.string(), withdrawalDays: z.number().int() }),
});

/** Cómo el navegador llega a la pasarela: GET a `url`, o POST de formulario con `fields`. */
export const checkoutRedirectResponse = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST"]),
  fields: z.record(z.string(), z.string()),
});

export const withdrawalResponse = z.object({ refundedAmount: z.number().int() });

export type WithdrawalResponse = z.infer<typeof withdrawalResponse>;
export type BillingSubscriptionResponse = z.infer<typeof billingSubscriptionResponse>;
export type BillingPaymentResponse = z.infer<typeof billingPaymentResponse>;
export type BillingOverviewResponse = z.infer<typeof billingOverviewResponse>;
export type CheckoutRedirectResponse = z.infer<typeof checkoutRedirectResponse>;

// ── Superadministración (F4.6d) ────────────────────────────────────────────────────────────────
// Ingresos **de Impulza** (lo que cada organización paga por su plan): no son datos comerciales de
// los clientes de una organización, así que no chocan con ADR-005 §5.

const moneyTotals = z.object({ total: z.number().int(), net: z.number().int(), vat: z.number().int() });

export const adminBillingSummaryResponse = z.object({
  /** Mes consultado, `YYYY-MM` en hora de Chile. */
  month: z.string(),
  /** Ingreso mensual recurrente: suscripciones vigentes normalizadas a un mes (anual / 12). */
  mrr: z.number().int(),
  arr: z.number().int(),
  /** Parte del MRR que puede perderse: morosas o canceladas que terminan al fin del período. */
  mrrAtRisk: z.number().int(),
  subscriptions: z.object({ active: z.number().int(), pastDue: z.number().int(), canceling: z.number().int() }),
  /** Primeras contrataciones y suscripciones terminadas en el mes. */
  movement: z.object({ newSubscriptions: z.number().int(), churned: z.number().int() }),
  /** Cobrado en el mes (aprobados, aunque se hayan reembolsado después) y reembolsado en el mes. */
  collected: moneyTotals,
  refunded: z.number().int(),
  failedPayments: z.number().int(),
  taxDocumentsPending: z.object({ count: z.number().int(), total: z.number().int() }),
  byPlan: z.array(z.object({ planCode: z.string(), planName: z.string(), subscriptions: z.number().int(), mrr: z.number().int() })),
  gateways: z.array(z.enum(["WEBPAY_ONECLICK", "MERCADO_PAGO"])),
});

export const adminPaymentResponse = z.object({
  id: uuid,
  organization: z.object({ id: uuid, name: z.string() }),
  planName: z.string(),
  gateway: gateway,
  amount: z.number().int(),
  netAmount: z.number().int(),
  vatAmount: z.number().int(),
  currency: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "REFUNDED"]),
  attempt: z.number().int(),
  /** Motivo técnico de un rechazo o de un reembolso que falló. */
  failureReason: z.string().nullable(),
  refundedAmount: z.number().int(),
  taxDocumentStatus: z.enum(["PENDING", "ISSUED", "NOT_REQUIRED"]),
  taxDocumentNumber: z.string().nullable(),
  periodStart: isoDateTime,
  periodEnd: isoDateTime,
  paidAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const adminPaymentListResponse = z.object({ items: z.array(adminPaymentResponse), total: z.number().int() });

export const adminRefundResponse = z.object({
  payment: adminPaymentResponse,
  /** La boleta ya estaba emitida: hay que emitir una nota de crédito por el monto devuelto. */
  creditNoteRequired: z.boolean(),
});

export type AdminBillingSummaryResponse = z.infer<typeof adminBillingSummaryResponse>;
export type AdminPaymentResponse = z.infer<typeof adminPaymentResponse>;
export type AdminPaymentListResponse = z.infer<typeof adminPaymentListResponse>;
export type AdminRefundResponse = z.infer<typeof adminRefundResponse>;
