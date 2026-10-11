import type { PaymentGateway } from "@impulza/database";

/**
 * Pasarela con la que Impulza cobra una SUSCRIPCIÓN (Oneclick o Mercado Pago, ADR-012). El enum de la base también lleva `WEBPAY_PLUS`
 * (ADR-030) porque comparte tabla con las cuentas de cobro de los negocios, pero una suscripción nunca la usa: si apareciera, es un
 * dato corrupto y se prefiere fallar a mostrar una pasarela que el contrato no conoce.
 */
export function subscriptionGateway(gateway: PaymentGateway): "WEBPAY_ONECLICK" | "MERCADO_PAGO" {
  if (gateway === "WEBPAY_PLUS") {
    throw new Error("Una suscripción de Impulza no puede cobrarse con Webpay Plus (es el medio de cobro de los negocios).");
  }
  return gateway;
}
