// Cobro de suscripciones (F4.6, ADR-012). Todo lo que sabe de pasarelas vive en este paquete: el
// resto del sistema pide "inscribe", "cobra", "reembolsa" y recibe resultados ya validados, o un
// `PaymentGatewayError` con un código estable. Nunca datos de tarjeta: solo referencias.

export const PAYMENT_GATEWAYS = ["WEBPAY_ONECLICK", "MERCADO_PAGO"] as const;
export type PaymentGatewayKind = (typeof PAYMENT_GATEWAYS)[number];

/**
 * Quién programa los cobros de cada período. `merchant`: Impulza cobra (Oneclick, sin webhooks).
 * `provider`: la pasarela cobra sola y avisa por webhook (Mercado Pago).
 */
export type RecurrenceOwner = "merchant" | "provider";

export const PAYMENT_ERROR_CODES = [
  /** No respondió a tiempo o no hubo conexión: el resultado es desconocido, hay que consultar. */
  "timeout",
  "unavailable",
  "auth_error",
  "not_found",
  /** La pasarela rechazó la petición por sus reglas de negocio (HTTP 422). */
  "rejected",
  "invalid_response",
] as const;
export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];

export class PaymentGatewayError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    /** `true` si reintentar más tarde puede funcionar (red, 5xx); `false` si no (credenciales, 4xx). */
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "PaymentGatewayError";
  }
}

/** Cómo el navegador llega a la pasarela. Oneclick exige un POST de formulario con el token. */
export interface EnrollmentRedirect {
  url: string;
  method: "GET" | "POST";
  /** Campos del formulario cuando `method` es POST (`TBK_TOKEN` en Oneclick). */
  fields: Record<string, string>;
  /** Referencia de la inscripción en curso, para confirmarla al volver. */
  token: string;
}

export interface EnrollmentResult {
  approved: boolean;
  /** Código de la pasarela (0 = aprobado en Transbank). Se registra; nunca se muestra crudo. */
  responseCode: number;
  /** Referencia reutilizable del medio de pago (`tbk_user`). Se guarda **cifrada**. */
  paymentMethodRef: string | null;
  /** Solo marca y últimos 4 dígitos: lo único de la tarjeta que se puede mostrar y guardar. */
  cardBrand: string | null;
  cardLast4: string | null;
}

export interface ChargeRequest {
  /** Identificador estable del cliente en la pasarela (id de organización, sin guiones). */
  customerRef: string;
  paymentMethodRef: string;
  /** Orden de compra **única**: el mismo valor nunca produce dos cobros (ver `buyOrderFor`). */
  buyOrder: string;
  /** Pesos enteros (CLP no tiene decimales). */
  amount: number;
}

export type ChargeStatus = "approved" | "rejected";

export interface ChargeResult {
  status: ChargeStatus;
  responseCode: number;
  authorizationCode: string | null;
}

export interface RefundResult {
  /** `NULLIFIED` (anulación, mismo día) o `REVERSED` (reversa) en Transbank; `REFUNDED` en el resto. */
  type: string;
  refundedAmount: number;
}

/** Puerto de una pasarela con recurrencia propia del comercio (Oneclick). Mercado Pago, que cobra
 *  solo, implementa su propio adaptador en F4.6b. */
export interface MerchantRecurringGateway {
  readonly kind: PaymentGatewayKind;
  readonly recurrence: "merchant";
  startEnrollment(input: { customerRef: string; email: string; returnUrl: string }): Promise<EnrollmentRedirect>;
  finishEnrollment(token: string): Promise<EnrollmentResult>;
  removeEnrollment(input: { customerRef: string; paymentMethodRef: string }): Promise<void>;
  charge(input: ChargeRequest): Promise<ChargeResult>;
  chargeStatus(buyOrder: string): Promise<ChargeResult | null>;
  refund(input: { buyOrder: string; amount: number }): Promise<RefundResult>;
}
