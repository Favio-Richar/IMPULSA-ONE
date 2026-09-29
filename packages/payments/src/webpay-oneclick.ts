import { z } from "zod";
import {
  type ChargeRequest,
  type ChargeResult,
  type EnrollmentRedirect,
  type EnrollmentResult,
  type MerchantRecurringGateway,
  PaymentGatewayError,
  type RefundResult,
} from "./types.js";

// Webpay Oneclick Mall de Transbank (F4.6a, ADR-012). REST directo con `fetch`, sin SDK: son seis
// llamadas y así controlamos timeouts, redirecciones y qué se registra. Referencia:
// https://www.transbankdevelopers.cl/referencia/oneclick (API v1.2).

export const WEBPAY_BASE_URLS = {
  integration: "https://webpay3gint.transbank.cl",
  production: "https://webpay3g.transbank.cl",
} as const;
export type WebpayEnvironment = keyof typeof WEBPAY_BASE_URLS;

/** Credenciales públicas del ambiente de integración de Transbank (documentadas por ellos). */
export const WEBPAY_INTEGRATION_CREDENTIALS = {
  commerceCode: "597055555541",
  childCommerceCode: "597055555542",
  apiKeySecret: "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C",
} as const;

export interface WebpayOneclickConfig {
  environment: WebpayEnvironment;
  /** Código de comercio "mall" (el que autentica). */
  commerceCode: string;
  /** Código de la tienda hija que recibe el cobro. */
  childCommerceCode: string;
  apiKeySecret: string;
  timeoutMs?: number;
}

const API_PATH = "/rswebpaytransaction/api/oneclick/v1.2";
const DEFAULT_TIMEOUT_MS = 20_000;

const startResponse = z.object({ token: z.string().min(1), url_webpay: z.string().url() });

const finishResponse = z.object({
  response_code: z.number().int(),
  tbk_user: z.string().nullish(),
  card_type: z.string().nullish(),
  card_number: z.string().nullish(),
});

const transactionResponse = z.object({
  buy_order: z.string(),
  details: z
    .array(
      z.object({
        status: z.string(),
        response_code: z.number().int(),
        authorization_code: z.string().nullish(),
        amount: z.number(),
      }),
    )
    .min(1),
});

const refundResponse = z.object({
  type: z.string(),
  nullified_amount: z.number().nullish(),
  reversed_amount: z.number().nullish(),
});

/** Transbank limita `buy_order` a 26 caracteres. La orden del mall y la de la tienda hija deben
 *  distinguirse: se derivan del mismo núcleo con un prefijo. */
export function oneclickBuyOrders(core: string): { parent: string; child: string } {
  if (!/^[A-Za-z0-9]{1,25}$/.test(core)) {
    throw new Error("El núcleo de la orden de compra debe ser alfanumérico y de hasta 25 caracteres.");
  }
  return { parent: `P${core}`, child: `C${core}` };
}

/** "XXXXXXXXXXXX6623" → "6623". Nunca se conserva nada más de la tarjeta. */
function last4(cardNumber: string | null | undefined): string | null {
  const digits = cardNumber?.replace(/\D/g, "") ?? "";
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export class WebpayOneclickGateway implements MerchantRecurringGateway {
  readonly kind = "WEBPAY_ONECLICK" as const;
  readonly recurrence = "merchant" as const;
  private readonly baseUrl: string;

  constructor(
    private readonly config: WebpayOneclickConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = WEBPAY_BASE_URLS[config.environment];
  }

  /** Paso 1: Transbank devuelve un token y la URL a la que el navegador debe hacer POST. */
  async startEnrollment(input: { customerRef: string; email: string; returnUrl: string }): Promise<EnrollmentRedirect> {
    const body = await this.request("POST", "/inscriptions", {
      username: input.customerRef,
      email: input.email,
      response_url: input.returnUrl,
    });
    const parsed = parse(startResponse, body);
    return { url: parsed.url_webpay, method: "POST", fields: { TBK_TOKEN: parsed.token }, token: parsed.token };
  }

  /** Paso 2: al volver de Transbank se confirma la inscripción. Rechazada = `approved: false`. */
  async finishEnrollment(token: string): Promise<EnrollmentResult> {
    const body = await this.request("PUT", `/inscriptions/${encodeURIComponent(token)}`, undefined);
    const parsed = parse(finishResponse, body);
    const approved = parsed.response_code === 0 && Boolean(parsed.tbk_user);
    return {
      approved,
      responseCode: parsed.response_code,
      paymentMethodRef: approved ? parsed.tbk_user! : null,
      cardBrand: parsed.card_type ?? null,
      cardLast4: last4(parsed.card_number),
    };
  }

  async removeEnrollment(input: { customerRef: string; paymentMethodRef: string }): Promise<void> {
    await this.request("DELETE", "/inscriptions", { tbk_user: input.paymentMethodRef, username: input.customerRef });
  }

  /** Cobra un período. Si falla por red, el resultado es desconocido: usar `chargeStatus` antes de
   *  reintentar (la misma orden de compra nunca se cobra dos veces en Transbank). */
  async charge(input: ChargeRequest): Promise<ChargeResult> {
    const orders = oneclickBuyOrders(input.buyOrder);
    const body = await this.request("POST", "/transactions", {
      username: input.customerRef,
      tbk_user: input.paymentMethodRef,
      buy_order: orders.parent,
      details: [
        {
          commerce_code: this.config.childCommerceCode,
          buy_order: orders.child,
          amount: input.amount,
          installments_number: 1,
        },
      ],
    });
    return toChargeResult(parse(transactionResponse, body));
  }

  /** Estado de un cobro ya intentado; `null` si Transbank no lo conoce (nunca llegó). */
  async chargeStatus(buyOrder: string): Promise<ChargeResult | null> {
    const orders = oneclickBuyOrders(buyOrder);
    try {
      const body = await this.request("GET", `/transactions/${orders.parent}`, undefined);
      return toChargeResult(parse(transactionResponse, body));
    } catch (error) {
      if (error instanceof PaymentGatewayError && error.code === "not_found") return null;
      throw error;
    }
  }

  async refund(input: { buyOrder: string; amount: number }): Promise<RefundResult> {
    const orders = oneclickBuyOrders(input.buyOrder);
    const body = await this.request("POST", `/transactions/${orders.parent}/refunds`, {
      commerce_code: this.config.childCommerceCode,
      detail_buy_order: orders.child,
      amount: input.amount,
    });
    const parsed = parse(refundResponse, body);
    return { type: parsed.type, refundedAmount: parsed.nullified_amount ?? parsed.reversed_amount ?? input.amount };
  }

  private async request(method: string, path: string, payload: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${API_PATH}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "Tbk-Api-Key-Id": this.config.commerceCode,
          "Tbk-Api-Key-Secret": this.config.apiKeySecret,
        },
        body: payload === undefined ? (method === "PUT" ? "{}" : undefined) : JSON.stringify(payload),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new PaymentGatewayError("timeout", true, "Transbank no respondió a tiempo.");
      }
      throw new PaymentGatewayError("unavailable", true, `No se pudo conectar con Transbank: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) return undefined;
    if (!response.ok) throw await errorForResponse(response);
    try {
      return await response.json();
    } catch {
      throw new PaymentGatewayError("invalid_response", false, "Transbank respondió algo que no es JSON.");
    }
  }
}

function toChargeResult(parsed: z.infer<typeof transactionResponse>): ChargeResult {
  const detail = parsed.details[0]!;
  const approved = detail.response_code === 0 && detail.status === "AUTHORIZED";
  return {
    status: approved ? "approved" : "rejected",
    responseCode: detail.response_code,
    authorizationCode: detail.authorization_code ?? null,
  };
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new PaymentGatewayError("invalid_response", false, "La respuesta de Transbank no tiene la forma esperada.");
  }
  return result.data;
}

async function errorForResponse(response: Response): Promise<PaymentGatewayError> {
  // El mensaje de Transbank (`error_message`) es técnico y no trae datos de tarjeta: sirve para el log.
  let detail = "";
  try {
    const body = (await response.json()) as { error_message?: unknown };
    if (typeof body.error_message === "string") detail = `: ${body.error_message.slice(0, 200)}`;
  } catch {
    // sin cuerpo JSON
  }
  if (response.status === 401 || response.status === 403) {
    return new PaymentGatewayError("auth_error", false, `Credenciales de Transbank rechazadas${detail}`);
  }
  // Transbank responde 422 (no 404) a una orden que no conoce: "Invalid value for parameter: buy
  // order not found" (verificado contra integración, 2026-09-29). Si se tratara como un rechazo, un
  // cobro que nunca llegó quedaría PENDING para siempre y la suscripción no se renovaría.
  if (response.status === 404 || (response.status === 422 && /not found/i.test(detail))) {
    return new PaymentGatewayError("not_found", false, `Transbank no encontró el recurso${detail}`);
  }
  if (response.status === 422 || response.status === 400) {
    return new PaymentGatewayError("rejected", false, `Transbank rechazó la petición${detail}`);
  }
  return new PaymentGatewayError("unavailable", true, `Transbank respondió ${response.status}${detail}`);
}
