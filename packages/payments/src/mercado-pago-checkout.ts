import { randomBytes } from "node:crypto";
import { z } from "zod";
import { MERCADO_PAGO_API } from "./mercado-pago.js";
import { PaymentGatewayError } from "./types.js";

// Checkout Pro a nombre de un negocio (F5.9, ADR-013): con el token OAuth de **su** cuenta
// conectada se crea una preferencia por pedido y, al avisar Mercado Pago, se consulta el pago. El
// dinero va directo al negocio; Impulza nunca ve la tarjeta (el comprador paga en Mercado Pago).
// El token viaja en cada llamada: un cliente no guarda el de ningún negocio entre llamadas.

const DEFAULT_TIMEOUT_MS = 20_000;

/** Monedas que cobra una cuenta de Mercado Pago Chile. Un pedido en otra moneda sigue con enlace externo. */
export const CHECKOUT_CURRENCIES = ["CLP"] as const;

export function checkoutSupportsCurrency(currency: string): boolean {
  return (CHECKOUT_CURRENCIES as readonly string[]).includes(currency);
}

export interface CheckoutPreferenceInput {
  /** Id del pedido: vuelve en el pago como `external_reference` y es la clave de idempotencia. */
  externalReference: string;
  title: string;
  quantity: number;
  /** Precio unitario en la unidad mínima de la moneda (CLP: pesos, sin decimales). */
  unitPrice: number;
  currency: string;
  payerEmail: string;
  payerName: string;
  notificationUrl: string;
  /** A dónde vuelve el comprador (pagado, rechazado o pendiente: la misma página muestra el estado). */
  backUrl: string;
  /** Hasta cuándo se puede pagar. */
  expiresAt: Date;
}

export interface CheckoutPreference {
  id: string;
  /** URL de pago de Mercado Pago a la que se lleva al comprador. */
  checkoutUrl: string;
}

/** Estados de un pago en Mercado Pago. Solo `approved` significa cobrado. */
export type CheckoutPaymentStatus = "approved" | "pending" | "authorized" | "in_process" | "in_mediation" | "rejected" | "cancelled" | "refunded" | "charged_back";

export interface CheckoutPayment {
  id: string;
  status: CheckoutPaymentStatus | string;
  statusDetail: string | null;
  externalReference: string | null;
  /** Monto en la unidad mínima de la moneda (CLP: pesos enteros). */
  amount: number;
  /** Cuánto se devolvió ya (reembolsos desde Impulza o desde la cuenta del negocio). */
  refundedAmount: number;
  currency: string;
  /** Cuenta de Mercado Pago que recibe el dinero: debe ser la conectada por el negocio. */
  collectorId: string | null;
  approvedAt: Date | null;
  liveMode: boolean;
}

const preferenceResponse = z.object({
  id: z.string().min(1),
  init_point: z.string().url(),
  sandbox_init_point: z.string().url().nullish(),
});

const refundResponse = z.object({ id: z.union([z.string(), z.number()]).transform(String), amount: z.number().nullish() });

const paymentResponse = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  status_detail: z.string().nullish(),
  external_reference: z.string().nullish(),
  transaction_amount: z.number().nonnegative(),
  transaction_amount_refunded: z.number().nonnegative().nullish(),
  currency_id: z.string(),
  collector_id: z.union([z.string(), z.number()]).transform(String).nullish(),
  date_approved: z.string().nullish(),
  live_mode: z.boolean().optional(),
});

export class MercadoPagoCheckout {
  constructor(
    private readonly options: { timeoutMs?: number } = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Crea la preferencia. `X-Idempotency-Key` = pedido: si la respuesta se pierde y se reintenta, Mercado
   * Pago no crea una segunda. Con credenciales de prueba se usa la URL del entorno de pruebas.
   */
  async createPreference(accessToken: string, input: CheckoutPreferenceInput, liveMode: boolean): Promise<CheckoutPreference> {
    if (!checkoutSupportsCurrency(input.currency)) {
      throw new PaymentGatewayError("rejected", false, `Mercado Pago no cobra en ${input.currency}.`);
    }
    const body = await this.request(accessToken, "POST", "/checkout/preferences", {
      items: [
        {
          id: input.externalReference,
          title: input.title.slice(0, 256),
          quantity: input.quantity,
          unit_price: input.unitPrice,
          currency_id: input.currency,
        },
      ],
      payer: { email: input.payerEmail, name: input.payerName.slice(0, 100) },
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      back_urls: { success: input.backUrl, failure: input.backUrl, pending: input.backUrl },
      auto_return: "approved",
      expires: true,
      expiration_date_to: input.expiresAt.toISOString(),
    }, { "x-idempotency-key": `pref-${input.externalReference}` });
    const parsed = parse(preferenceResponse, body);
    return { id: parsed.id, checkoutUrl: liveMode ? parsed.init_point : (parsed.sandbox_init_point ?? parsed.init_point) };
  }

  async getPayment(accessToken: string, paymentId: string): Promise<CheckoutPayment> {
    const parsed = parse(paymentResponse, await this.request(accessToken, "GET", `/v1/payments/${encodeURIComponent(paymentId)}`, undefined));
    const approvedAt = parsed.date_approved ? new Date(parsed.date_approved) : null;
    return {
      id: parsed.id,
      status: parsed.status,
      statusDetail: parsed.status_detail ?? null,
      externalReference: parsed.external_reference ?? null,
      // CLP no tiene decimales; Mercado Pago lo manda como número.
      amount: Math.round(parsed.transaction_amount),
      refundedAmount: Math.round(parsed.transaction_amount_refunded ?? 0),
      currency: parsed.currency_id,
      collectorId: parsed.collector_id ?? null,
      approvedAt: approvedAt && !Number.isNaN(approvedAt.getTime()) ? approvedAt : null,
      liveMode: parsed.live_mode ?? true,
    };
  }

  /**
   * Reembolso total (sin `amount`) o parcial de un pago, con el token del negocio dueño del cobro.
   * `idempotencyKey` evita devolver dos veces si la respuesta se pierde y se reintenta.
   */
  async refundPayment(accessToken: string, paymentId: string, amount: number | undefined, idempotencyKey: string): Promise<{ id: string; amount: number }> {
    const body = await this.request(
      accessToken,
      "POST",
      `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      amount === undefined ? {} : { amount },
      { "x-idempotency-key": idempotencyKey },
    );
    const parsed = parse(refundResponse, body);
    return { id: parsed.id, amount: Math.round(parsed.amount ?? amount ?? 0) };
  }

  private async request(accessToken: string, method: string, path: string, payload: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${MERCADO_PAGO_API}${path}`, {
        method,
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${accessToken}`, ...extraHeaders },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      if (controller.signal.aborted) throw new PaymentGatewayError("timeout", true, "Mercado Pago no respondió a tiempo.");
      throw new PaymentGatewayError("unavailable", true, `No se pudo conectar con Mercado Pago: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) throw new PaymentGatewayError("auth_error", false, "Mercado Pago rechazó el token del negocio.");
    if (response.status === 404) throw new PaymentGatewayError("not_found", false, "Mercado Pago no encontró el recurso.");
    if (response.status === 400 || response.status === 422) throw new PaymentGatewayError("rejected", false, "Mercado Pago rechazó la petición.");
    if (!response.ok) throw new PaymentGatewayError("unavailable", true, `Mercado Pago respondió ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new PaymentGatewayError("invalid_response", false, "Mercado Pago respondió algo que no es JSON.");
    }
  }
}

/** Lo que un pago tiene que cumplir para aplicarse a un cobro (pedido o seña). */
export interface ExpectedCheckoutPayment {
  externalReference: string;
  /** Cuenta de Mercado Pago conectada por el negocio: la única que puede recibir el dinero. */
  collectorId: string;
  amount: number;
  currency: string;
}

/**
 * Regla única de F5.9/F5.10 (ADR-013): un pago se aplica solo si es de **ese** cobro, llegó a la
 * cuenta del negocio y por el monto y moneda exactos. Devuelve qué no coincide (vacío = coincide),
 * para registrarlo sin datos personales.
 */
export function checkoutPaymentMismatches(payment: CheckoutPayment, expected: ExpectedCheckoutPayment): Array<"reference" | "collector" | "amount"> {
  const mismatches: Array<"reference" | "collector" | "amount"> = [];
  if (payment.externalReference !== expected.externalReference) mismatches.push("reference");
  if (payment.collectorId !== expected.collectorId) mismatches.push("collector");
  if (payment.amount !== expected.amount || payment.currency !== expected.currency) mismatches.push("amount");
  return mismatches;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new PaymentGatewayError("invalid_response", false, "La respuesta de Mercado Pago no tiene la forma esperada.");
  return result.data;
}

export type MercadoPagoCheckoutLike = Pick<MercadoPagoCheckout, "createPreference" | "getPayment" | "refundPayment">;

/**
 * Checkout simulado para pruebas: guarda preferencias y pagos en memoria, **por token** — un token
 * solo ve los pagos de su cuenta, como en Mercado Pago (así se prueba el aislamiento entre negocios).
 */
export class FakeMercadoPagoCheckout implements MercadoPagoCheckoutLike {
  readonly preferences: Array<CheckoutPreferenceInput & { id: string; accessToken: string }> = [];
  private readonly payments = new Map<string, { accessToken: string; payment: CheckoutPayment }>();
  failNextPreference = false;
  failNextRefund = false;
  readonly refunds: Array<{ accessToken: string; paymentId: string; amount: number; idempotencyKey: string }> = [];

  async createPreference(accessToken: string, input: CheckoutPreferenceInput): Promise<CheckoutPreference> {
    if (this.failNextPreference) {
      this.failNextPreference = false;
      throw new PaymentGatewayError("unavailable", true, "Simulación: Mercado Pago caído.");
    }
    if (!checkoutSupportsCurrency(input.currency)) throw new PaymentGatewayError("rejected", false, `Mercado Pago no cobra en ${input.currency}.`);
    const id = `pref-${randomBytes(6).toString("hex")}`;
    this.preferences.push({ ...input, id, accessToken });
    return { id, checkoutUrl: `https://www.mercadopago.cl/checkout/v1/redirect?pref_id=${id}` };
  }

  async getPayment(accessToken: string, paymentId: string): Promise<CheckoutPayment> {
    const found = this.payments.get(paymentId);
    // Mercado Pago responde 404 a un pago de otra cuenta.
    if (!found || found.accessToken !== accessToken) throw new PaymentGatewayError("not_found", false, "Pago desconocido.");
    return { ...found.payment };
  }

  async refundPayment(accessToken: string, paymentId: string, amount: number | undefined, idempotencyKey: string): Promise<{ id: string; amount: number }> {
    const found = this.payments.get(paymentId);
    if (!found || found.accessToken !== accessToken) throw new PaymentGatewayError("not_found", false, "Pago desconocido.");
    if (this.failNextRefund) {
      this.failNextRefund = false;
      throw new PaymentGatewayError("unavailable", true, "Simulación: Mercado Pago caído.");
    }
    // Misma clave = mismo reembolso (lo que hace Mercado Pago con X-Idempotency-Key).
    const repeated = this.refunds.find((item) => item.idempotencyKey === idempotencyKey);
    if (repeated) return { id: `ref-${repeated.idempotencyKey}`, amount: repeated.amount };
    const payment = found.payment;
    const remaining = payment.amount - payment.refundedAmount;
    const value = amount ?? remaining;
    if (payment.status !== "approved" || value <= 0 || value > remaining) throw new PaymentGatewayError("rejected", false, "Reembolso inválido.");
    payment.refundedAmount += value;
    if (payment.refundedAmount === payment.amount) payment.status = "refunded";
    this.refunds.push({ accessToken, paymentId, amount: value, idempotencyKey });
    return { id: `ref-${idempotencyKey}`, amount: value };
  }

  /** Simula que el comprador paga (o lo intenta) la preferencia de un pedido. Devuelve el id del pago. */
  pay(
    externalReference: string,
    input: { status?: string; collectorId: string; amount?: number; currency?: string; accessToken?: string },
  ): string {
    const preference = [...this.preferences].reverse().find((item) => item.externalReference === externalReference);
    if (!preference) throw new Error(`Sin preferencia para ${externalReference}`);
    // Únicos entre corridas, como los de Mercado Pago (la base de pruebas conserva los avisos ya procesados).
    const id = `${Date.now()}${randomBytes(3).readUIntBE(0, 3)}`;
    const status = input.status ?? "approved";
    this.payments.set(id, {
      accessToken: input.accessToken ?? preference.accessToken,
      payment: {
        id,
        status,
        statusDetail: status === "approved" ? "accredited" : null,
        externalReference,
        amount: input.amount ?? preference.unitPrice * preference.quantity,
        refundedAmount: 0,
        currency: input.currency ?? preference.currency,
        collectorId: input.collectorId,
        approvedAt: status === "approved" ? new Date() : null,
        liveMode: false,
      },
    });
    return id;
  }

  /** Cambia el estado de un pago ya creado (p. ej. `pending` → `approved`). */
  setStatus(paymentId: string, status: string): void {
    const found = this.payments.get(paymentId)?.payment;
    if (found) {
      found.status = status;
      found.approvedAt = status === "approved" ? new Date() : found.approvedAt;
    }
  }
}
