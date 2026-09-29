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
  legal: z.object({ termsVersion: z.string(), withdrawalNoticeVersion: z.string(), withdrawalDays: z.number().int() }),
});

/** Cómo el navegador llega a la pasarela: GET a `url`, o POST de formulario con `fields`. */
export const checkoutRedirectResponse = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST"]),
  fields: z.record(z.string(), z.string()),
});

export type BillingSubscriptionResponse = z.infer<typeof billingSubscriptionResponse>;
export type BillingPaymentResponse = z.infer<typeof billingPaymentResponse>;
export type BillingOverviewResponse = z.infer<typeof billingOverviewResponse>;
export type CheckoutRedirectResponse = z.infer<typeof checkoutRedirectResponse>;
