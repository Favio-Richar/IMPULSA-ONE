import type { MercadoPagoCheckoutLike } from "@impulza/payments";

/**
 * Checkout Pro de los negocios (pedidos F5.9, señas F5.10) y la clave de firma de los avisos de la
 * aplicación de Impulza en Mercado Pago, o `null` si la aplicación no está configurada. Las pruebas
 * lo reemplazan por `FakeMercadoPagoCheckout` (`@impulza/payments`).
 */
export const MERCADO_PAGO_CHECKOUT = Symbol("MERCADO_PAGO_CHECKOUT");

/**
 * Webpay Plus del negocio (F10.2c, ADR-030): cliente HTTP sin estado; las credenciales son las de CADA negocio y se pasan en cada llamada.
 * Las pruebas lo reemplazan por `FakeWebpayPlus` (`@impulza/payments`).
 */
export const WEBPAY_PLUS_GATEWAY = Symbol("WEBPAY_PLUS_GATEWAY");

export interface CheckoutConfig {
  checkout: MercadoPagoCheckoutLike;
  webhookSecret: string;
}
