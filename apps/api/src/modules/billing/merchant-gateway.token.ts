/** Pasarela con recurrencia del comercio (Webpay Oneclick) o `null` si no está configurada.
 *  Las pruebas la reemplazan por `FakeRecurringGateway` (`@impulza/payments`). */
export const MERCHANT_GATEWAY = Symbol("MERCHANT_GATEWAY");
