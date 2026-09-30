import type { MercadoPagoCheckoutLike } from "@impulza/payments";

/**
 * Checkout Pro de los negocios (pedidos F5.9, señas F5.10) y la clave de firma de los avisos de la
 * aplicación de Impulza en Mercado Pago, o `null` si la aplicación no está configurada. Las pruebas
 * lo reemplazan por `FakeMercadoPagoCheckout` (`@impulza/payments`).
 */
export const MERCADO_PAGO_CHECKOUT = Symbol("MERCADO_PAGO_CHECKOUT");

export interface CheckoutConfig {
  checkout: MercadoPagoCheckoutLike;
  webhookSecret: string;
}
