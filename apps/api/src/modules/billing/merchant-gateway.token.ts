/** Pasarela con recurrencia del comercio (Webpay Oneclick) o `null` si no está configurada.
 *  Las pruebas la reemplazan por `FakeRecurringGateway` (`@impulza/payments`). */
export const MERCHANT_GATEWAY = Symbol("MERCHANT_GATEWAY");

/** Mercado Pago (F4.6b) o `null` si no está configurado. Las pruebas usan `FakeMercadoPagoGateway`. */
export const MERCADO_PAGO_GATEWAY = Symbol("MERCADO_PAGO_GATEWAY");
