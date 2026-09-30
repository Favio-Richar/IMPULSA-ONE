import type { MercadoPagoCheckoutLike } from "@impulza/payments";

/**
 * Checkout Pro de los negocios (F5.9) y la clave de firma de los avisos de la aplicación de Impulza
 * en Mercado Pago, o `null` si la aplicación no está configurada. Las pruebas lo reemplazan por
 * `FakeMercadoPagoCheckout` (`@impulza/payments`).
 */
export const ORDER_CHECKOUT = Symbol("ORDER_CHECKOUT");

export interface OrderCheckoutConfig {
  checkout: MercadoPagoCheckoutLike;
  webhookSecret: string;
}
