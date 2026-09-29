import {
  type ChargeRequest,
  type ChargeResult,
  type EnrollmentRedirect,
  type EnrollmentResult,
  type MerchantRecurringGateway,
  PaymentGatewayError,
  type RefundResult,
} from "./types.js";

/**
 * Pasarela en memoria para pruebas y desarrollo sin red (como `FakeProvider` de `@impulza/ai`).
 * Se comporta como Oneclick: la misma orden de compra nunca cobra dos veces, y `nextCharge` permite
 * forzar un rechazo o una caída de red en el próximo cobro.
 */
export class FakeRecurringGateway implements MerchantRecurringGateway {
  readonly kind = "WEBPAY_ONECLICK" as const;
  readonly recurrence = "merchant" as const;

  /** Resultado del próximo `finishEnrollment`. */
  nextEnrollment: "approved" | "rejected" = "approved";
  /** Resultados de los próximos cobros, en orden; vacío = aprobado. `"network"` lanza un error de red
   *  **después** de registrar el cobro, como un timeout en el que Transbank sí cobró. */
  nextCharges: Array<"approved" | "rejected" | "network"> = [];

  readonly charges = new Map<string, ChargeResult & { amount: number }>();
  readonly refunds: Array<{ buyOrder: string; amount: number }> = [];
  readonly removed: string[] = [];
  private enrollmentSeq = 0;

  async startEnrollment(input: { returnUrl: string }): Promise<EnrollmentRedirect> {
    this.enrollmentSeq += 1;
    const token = `fake-token-${this.enrollmentSeq}`;
    return { url: `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}TBK_TOKEN=${token}`, method: "GET", fields: {}, token };
  }

  async finishEnrollment(token: string): Promise<EnrollmentResult> {
    if (this.nextEnrollment === "rejected") {
      return { approved: false, responseCode: -1, paymentMethodRef: null, cardBrand: null, cardLast4: null };
    }
    return { approved: true, responseCode: 0, paymentMethodRef: `tbk-user-${token}`, cardBrand: "Visa", cardLast4: "6623" };
  }

  async removeEnrollment(input: { paymentMethodRef: string }): Promise<void> {
    this.removed.push(input.paymentMethodRef);
  }

  async charge(input: ChargeRequest): Promise<ChargeResult> {
    const existing = this.charges.get(input.buyOrder);
    if (existing) {
      // Transbank rechaza una orden repetida; nunca cobra dos veces.
      return { status: "rejected", responseCode: -96, authorizationCode: null };
    }
    const outcome = this.nextCharges.shift() ?? "approved";
    const result: ChargeResult =
      outcome === "rejected"
        ? { status: "rejected", responseCode: -1, authorizationCode: null }
        : { status: "approved", responseCode: 0, authorizationCode: `A${this.charges.size + 1}` };
    this.charges.set(input.buyOrder, { ...result, amount: input.amount });
    if (outcome === "network") {
      throw new PaymentGatewayError("timeout", true, "Simulación: sin respuesta de la pasarela.");
    }
    return result;
  }

  async chargeStatus(buyOrder: string): Promise<ChargeResult | null> {
    const charge = this.charges.get(buyOrder);
    return charge ? { status: charge.status, responseCode: charge.responseCode, authorizationCode: charge.authorizationCode } : null;
  }

  async refund(input: { buyOrder: string; amount: number }): Promise<RefundResult> {
    this.refunds.push(input);
    return { type: "REVERSED", refundedAmount: input.amount };
  }
}
