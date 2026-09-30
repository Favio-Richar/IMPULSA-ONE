import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PaymentGatewayError, type RefundResult } from "./types.js";

// Mercado Pago Suscripciones (F4.6b, ADR-012). A diferencia de Oneclick, **Mercado Pago cobra solo**
// cada período (`recurrence: "provider"`) y avisa por webhook. REST directo con `fetch`, igual que
// el adaptador de Transbank. Referencias: API `/preapproval`, `/authorized_payments/{id}`,
// `/v1/payments/{id}/refunds` y la firma `x-signature` de las notificaciones.

export const MERCADO_PAGO_API = "https://api.mercadopago.com";
const DEFAULT_TIMEOUT_MS = 20_000;

export interface MercadoPagoConfig {
  accessToken: string;
  /** Clave secreta de la firma de webhooks ("Tus integraciones" → Webhooks). */
  webhookSecret: string;
  timeoutMs?: number;
}

/** Estados de una suscripción en Mercado Pago. `pending`: aún no autoriza el pagador. */
export type PreapprovalStatus = "pending" | "authorized" | "paused" | "cancelled";

export interface Preapproval {
  id: string;
  status: PreapprovalStatus | string;
  externalReference: string | null;
  initPoint: string | null;
}

/** Una cuota ("pago autorizado") de una suscripción. */
export interface AuthorizedPayment {
  id: string;
  preapprovalId: string;
  /** Estado de la cuota: `scheduled`, `processed`, `recycling` (reintentando), `cancelled`… */
  status: string;
  amount: number;
  currency: string;
  debitDate: Date | null;
  nextRetryDate: Date | null;
  /** El pago real detrás de la cuota, si ya se intentó cobrar. */
  payment: { id: string; status: string } | null;
}

const preapprovalResponse = z.object({
  id: z.string().min(1),
  status: z.string(),
  external_reference: z.string().nullish(),
  init_point: z.string().url().nullish(),
});

const authorizedPaymentResponse = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  preapproval_id: z.string().min(1),
  status: z.string(),
  transaction_amount: z.number().nonnegative(),
  currency_id: z.string(),
  debit_date: z.string().nullish(),
  next_retry_date: z.string().nullish(),
  payment: z
    .object({ id: z.union([z.string(), z.number()]).transform(String), status: z.string() })
    .nullish(),
});

const refundResponse = z.object({ id: z.union([z.string(), z.number()]), amount: z.number().nullish() });

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export class MercadoPagoGateway {
  readonly kind = "MERCADO_PAGO" as const;
  readonly recurrence = "provider" as const;

  constructor(
    private readonly config: MercadoPagoConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Crea la suscripción en estado `pending`: el cliente la autoriza en `initPoint` (sitio de Mercado
   * Pago) y desde ahí Mercado Pago cobra cada período. `externalReference` une la suscripción con
   * nuestra contratación (`BillingCheckout.id`): nunca se confía en otra cosa al volver.
   */
  async createSubscription(input: {
    reason: string;
    externalReference: string;
    payerEmail: string;
    amount: number;
    frequencyMonths: 1 | 12;
    backUrl: string;
  }): Promise<Preapproval> {
    const body = await this.request("POST", "/preapproval", {
      reason: input.reason.slice(0, 255),
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      status: "pending",
      auto_recurring: { frequency: input.frequencyMonths, frequency_type: "months", transaction_amount: input.amount, currency_id: "CLP" },
    });
    const parsed = parse(preapprovalResponse, body);
    if (!parsed.init_point) throw new PaymentGatewayError("invalid_response", false, "Mercado Pago no devolvió la URL de pago.");
    return this.toPreapproval(parsed);
  }

  async getSubscription(id: string): Promise<Preapproval> {
    return this.toPreapproval(parse(preapprovalResponse, await this.request("GET", `/preapproval/${encodeURIComponent(id)}`, undefined)));
  }

  /** Cancela en Mercado Pago: no vuelve a cobrar. Es definitivo (no se puede reanudar). */
  async cancelSubscription(id: string): Promise<void> {
    await this.request("PUT", `/preapproval/${encodeURIComponent(id)}`, { status: "cancelled" });
  }

  async getAuthorizedPayment(id: string): Promise<AuthorizedPayment> {
    const parsed = parse(authorizedPaymentResponse, await this.request("GET", `/authorized_payments/${encodeURIComponent(id)}`, undefined));
    return {
      id: parsed.id,
      preapprovalId: parsed.preapproval_id,
      status: parsed.status,
      // CLP no tiene decimales: Mercado Pago lo manda como número; se guarda en pesos enteros.
      amount: Math.round(parsed.transaction_amount),
      currency: parsed.currency_id,
      debitDate: toDate(parsed.debit_date),
      nextRetryDate: toDate(parsed.next_retry_date),
      payment: parsed.payment ?? null,
    };
  }

  /** Reembolso total (sin `amount`) o parcial de un pago. */
  async refundPayment(paymentId: string, amount?: number): Promise<RefundResult> {
    const body = await this.request("POST", `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, amount === undefined ? {} : { amount });
    const parsed = parse(refundResponse, body);
    return { type: "REFUNDED", refundedAmount: Math.round(parsed.amount ?? amount ?? 0) };
  }

  /**
   * Verifica la firma de una notificación (`x-signature: ts=…,v1=…`): HMAC-SHA256 con la clave
   * secreta sobre `id:{data.id};request-id:{x-request-id};ts:{ts};` (el `data.id` en minúsculas; un
   * valor ausente se omite con su etiqueta). Comparación en tiempo constante. Se llama **antes** de
   * leer nada del cuerpo.
   */
  verifyWebhookSignature(input: { signature: string | undefined; requestId: string | undefined; dataId: string | undefined }): boolean {
    return verifyMercadoPagoSignature({ ...input, secret: this.config.webhookSecret });
  }

  private toPreapproval(parsed: z.infer<typeof preapprovalResponse>): Preapproval {
    return { id: parsed.id, status: parsed.status, externalReference: parsed.external_reference ?? null, initPoint: parsed.init_point ?? null };
  }

  private async request(method: string, path: string, payload: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${MERCADO_PAGO_API}${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.accessToken}` },
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
    if (!response.ok) throw await errorForResponse(response);
    try {
      return await response.json();
    } catch {
      throw new PaymentGatewayError("invalid_response", false, "Mercado Pago respondió algo que no es JSON.");
    }
  }
}

export function verifyMercadoPagoSignature(input: { signature: string | undefined; requestId: string | undefined; dataId: string | undefined; secret: string }): boolean {
  if (!input.signature || !input.secret) return false;
  const parts = new Map<string, string>();
  for (const piece of input.signature.split(",")) {
    const [key, ...rest] = piece.split("=");
    if (key && rest.length > 0) parts.set(key.trim(), rest.join("=").trim());
  }
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;

  let manifest = "";
  if (input.dataId) manifest += `id:${input.dataId.toLowerCase()};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest();
  const received = Buffer.from(v1, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new PaymentGatewayError("invalid_response", false, "La respuesta de Mercado Pago no tiene la forma esperada.");
  return result.data;
}

async function errorForResponse(response: Response): Promise<PaymentGatewayError> {
  let detail = "";
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") detail = `: ${body.message.slice(0, 200)}`;
  } catch {
    // sin cuerpo JSON
  }
  if (response.status === 401 || response.status === 403) return new PaymentGatewayError("auth_error", false, `Credenciales de Mercado Pago rechazadas${detail}`);
  if (response.status === 404) return new PaymentGatewayError("not_found", false, `Mercado Pago no encontró el recurso${detail}`);
  if (response.status === 400 || response.status === 422) return new PaymentGatewayError("rejected", false, `Mercado Pago rechazó la petición${detail}`);
  return new PaymentGatewayError("unavailable", true, `Mercado Pago respondió ${response.status}${detail}`);
}

/** Pasarela simulada para pruebas: guarda suscripciones y cuotas en memoria. */
export class FakeMercadoPagoGateway {
  readonly kind = "MERCADO_PAGO" as const;
  readonly recurrence = "provider" as const;
  readonly subscriptions = new Map<string, Preapproval & { amount: number; payerEmail: string }>();
  readonly authorizedPayments = new Map<string, AuthorizedPayment>();
  readonly refunds: Array<{ paymentId: string; amount?: number }> = [];
  readonly canceled: string[] = [];
  failNextRefund = false;
  private seq = 0;

  constructor(readonly webhookSecret = "secreto-de-pruebas-de-mercado-pago-000000") {}

  async createSubscription(input: { externalReference: string; payerEmail: string; amount: number }): Promise<Preapproval> {
    this.seq += 1;
    const id = `pre${this.seq}${Date.now().toString(36)}`;
    const preapproval = { id, status: "pending", externalReference: input.externalReference, initPoint: `https://www.mercadopago.cl/subscriptions/checkout?preapproval_id=${id}`, amount: input.amount, payerEmail: input.payerEmail };
    this.subscriptions.set(id, preapproval);
    return preapproval;
  }

  async getSubscription(id: string): Promise<Preapproval> {
    const found = this.subscriptions.get(id);
    if (!found) throw new PaymentGatewayError("not_found", false, "Suscripción desconocida.");
    return found;
  }

  async cancelSubscription(id: string): Promise<void> {
    const found = this.subscriptions.get(id);
    if (found) found.status = "cancelled";
    this.canceled.push(id);
  }

  async getAuthorizedPayment(id: string): Promise<AuthorizedPayment> {
    const found = this.authorizedPayments.get(id);
    if (!found) throw new PaymentGatewayError("not_found", false, "Cuota desconocida.");
    return found;
  }

  async refundPayment(paymentId: string, amount?: number): Promise<RefundResult> {
    if (this.failNextRefund) {
      this.failNextRefund = false;
      throw new PaymentGatewayError("unavailable", true, "Simulación: Mercado Pago caído.");
    }
    this.refunds.push({ paymentId, amount });
    return { type: "REFUNDED", refundedAmount: amount ?? 0 };
  }

  verifyWebhookSignature(input: { signature: string | undefined; requestId: string | undefined; dataId: string | undefined }): boolean {
    return verifyMercadoPagoSignature({ ...input, secret: this.webhookSecret });
  }

  // ── Ayudas para simular lo que hace Mercado Pago ──

  authorize(id: string): void {
    const found = this.subscriptions.get(id);
    if (found) found.status = "authorized";
  }

  /** Mercado Pago intenta cobrar una cuota. Devuelve el id de la cuota (para el webhook). */
  charge(preapprovalId: string, outcome: "approved" | "rejected", debitDate = new Date()): string {
    this.seq += 1;
    // Únicos entre corridas, como los de Mercado Pago (la base de pruebas conserva los avisos ya
    // procesados: un id repetido se tomaría por un aviso duplicado).
    const id = `${Date.now()}${String(this.seq).padStart(4, "0")}`;
    const amount = this.subscriptions.get(preapprovalId)?.amount ?? 0;
    this.authorizedPayments.set(id, {
      id,
      preapprovalId,
      status: outcome === "approved" ? "processed" : "recycling",
      amount,
      currency: "CLP",
      debitDate,
      nextRetryDate: outcome === "rejected" ? new Date(debitDate.getTime() + 2 * 24 * 3_600_000) : null,
      payment: { id: `9${id}`, status: outcome },
    });
    return id;
  }

  /** Firma una notificación como lo haría Mercado Pago (para las pruebas del webhook). */
  sign(dataId: string, requestId: string, ts = String(Date.now())): string {
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    return `ts=${ts},v1=${createHmac("sha256", this.webhookSecret).update(manifest).digest("hex")}`;
  }
}

/** Lo que usan la API y el worker: la real o la simulada. */
export type MercadoPagoLike = Pick<
  MercadoPagoGateway,
  "kind" | "recurrence" | "createSubscription" | "getSubscription" | "cancelSubscription" | "getAuthorizedPayment" | "refundPayment" | "verifyWebhookSignature"
>;
