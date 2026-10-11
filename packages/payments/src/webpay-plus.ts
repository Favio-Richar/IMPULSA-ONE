import { randomBytes } from "node:crypto";
import { z } from "zod";
import { PaymentGatewayError } from "./types.js";
import { WEBPAY_BASE_URLS, type WebpayEnvironment } from "./webpay-oneclick.js";

// Webpay Plus de Transbank como medio de cobro del NEGOCIO (F10.2c, ADR-030). REST directo con `fetch`, sin SDK. A diferencia de la
// suscripción de Impulza (Oneclick, ADR-012), acá las credenciales son las del propio negocio y se pasan en cada llamada: un mismo
// proceso cobra para muchos comercios y ninguno comparte llave con otro. Referencia:
// https://www.transbankdevelopers.cl/referencia/webpay (API v1.2).

const API_PATH = "/rswebpaytransaction/api/webpay/v1.2";
const DEFAULT_TIMEOUT_MS = 20_000;

/** Credenciales públicas del comercio de integración de Webpay Plus (documentadas por Transbank). */
export const WEBPAY_PLUS_INTEGRATION_CREDENTIALS = {
  commerceCode: "597055555532",
  apiKeySecret: "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C",
} as const;

export interface WebpayPlusCredentials {
  /** Código de comercio del negocio (12 dígitos). No es secreto. */
  commerceCode: string;
  /** Llave secreta del comercio. Secreto: nunca se registra ni se devuelve. */
  apiKeySecret: string;
  environment: WebpayEnvironment;
}

export interface WebpayPlusCreateInput {
  /** Orden de compra: alfanumérica de hasta 26 caracteres (límite de Transbank). */
  buyOrder: string;
  /** Identificador de sesión: libre, hasta 61 caracteres. */
  sessionId: string;
  /** Monto en pesos, entero positivo. */
  amount: number;
  returnUrl: string;
}

export interface WebpayPlusTransaction {
  token: string;
  /** Dónde el navegador debe hacer POST con el campo `token_ws`. */
  url: string;
}

export interface WebpayPlusResult {
  status: string;
  responseCode: number;
  amount: number;
  buyOrder: string;
  sessionId: string;
  authorizationCode: string | null;
  /** Solo los últimos 4 dígitos: lo único de la tarjeta que se conserva. */
  cardLast4: string | null;
  transactionDate: Date | null;
}

export interface WebpayPlusLike {
  create(credentials: WebpayPlusCredentials, input: WebpayPlusCreateInput): Promise<WebpayPlusTransaction>;
  /** Confirma la transacción al volver el comprador. Transbank solo lo admite una vez por token. */
  commit(credentials: WebpayPlusCredentials, token: string): Promise<WebpayPlusResult>;
  status(credentials: WebpayPlusCredentials, token: string): Promise<WebpayPlusResult>;
  refund(credentials: WebpayPlusCredentials, token: string, amount: number): Promise<{ type: string; refundedAmount: number }>;
}

/** `M` + hasta 25 caracteres alfanuméricos: la orden de compra de Transbank admite 26. */
export function webpayPlusBuyOrder(core: string): string {
  if (!/^[A-Za-z0-9]{1,25}$/.test(core)) {
    throw new Error("El núcleo de la orden de compra debe ser alfanumérico y de hasta 25 caracteres.");
  }
  return `M${core}`;
}

/** Orden de compra nueva y aleatoria (96 bits): corta, única y sin relación con el identificador interno. */
export function newWebpayPlusBuyOrder(): string {
  return webpayPlusBuyOrder(randomBytes(12).toString("hex").slice(0, 24));
}

/**
 * Por qué una transacción confirmada NO corresponde a lo esperado (vacío = corresponde). La orden de compra y el monto salen de lo que
 * guardamos al crear la transacción, nunca de lo que diga la URL de regreso.
 */
export function webpayPlusMismatches(result: WebpayPlusResult, expected: { buyOrder: string; amount: number }): string[] {
  const reasons: string[] = [];
  if (result.status !== "AUTHORIZED") reasons.push("status");
  if (result.responseCode !== 0) reasons.push("response_code");
  if (result.buyOrder !== expected.buyOrder) reasons.push("buy_order");
  if (result.amount !== expected.amount) reasons.push("amount");
  return reasons;
}

const createResponse = z.object({ token: z.string().min(1), url: z.string().url() });

const resultResponse = z.object({
  status: z.string(),
  response_code: z.number().int(),
  amount: z.number(),
  buy_order: z.string(),
  session_id: z.string(),
  authorization_code: z.string().nullish(),
  card_detail: z.object({ card_number: z.string().nullish() }).nullish(),
  transaction_date: z.string().nullish(),
});

const refundResponse = z.object({
  type: z.string(),
  nullified_amount: z.number().nullish(),
  balance: z.number().nullish(),
});

function last4(cardNumber: string | null | undefined): string | null {
  const digits = cardNumber?.replace(/\D/g, "") ?? "";
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function toResult(parsed: z.infer<typeof resultResponse>): WebpayPlusResult {
  const date = parsed.transaction_date ? new Date(parsed.transaction_date) : null;
  return {
    status: parsed.status,
    responseCode: parsed.response_code,
    amount: parsed.amount,
    buyOrder: parsed.buy_order,
    sessionId: parsed.session_id,
    authorizationCode: parsed.authorization_code ?? null,
    cardLast4: last4(parsed.card_detail?.card_number),
    transactionDate: date && !Number.isNaN(date.getTime()) ? date : null,
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
  if (response.status === 404 || (response.status === 422 && /not found/i.test(detail))) {
    return new PaymentGatewayError("not_found", false, `Transbank no encontró la transacción${detail}`);
  }
  if (response.status === 422 || response.status === 400) {
    return new PaymentGatewayError("rejected", false, `Transbank rechazó la petición${detail}`);
  }
  return new PaymentGatewayError("unavailable", true, `Transbank respondió ${response.status}${detail}`);
}

export class WebpayPlus implements WebpayPlusLike {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async create(credentials: WebpayPlusCredentials, input: WebpayPlusCreateInput): Promise<WebpayPlusTransaction> {
    const body = await this.request(credentials, "POST", "/transactions", {
      buy_order: input.buyOrder,
      session_id: input.sessionId,
      amount: input.amount,
      return_url: input.returnUrl,
    });
    return parse(createResponse, body);
  }

  async commit(credentials: WebpayPlusCredentials, token: string): Promise<WebpayPlusResult> {
    const body = await this.request(credentials, "PUT", `/transactions/${encodeURIComponent(token)}`, undefined);
    return toResult(parse(resultResponse, body));
  }

  async status(credentials: WebpayPlusCredentials, token: string): Promise<WebpayPlusResult> {
    const body = await this.request(credentials, "GET", `/transactions/${encodeURIComponent(token)}`, undefined);
    return toResult(parse(resultResponse, body));
  }

  async refund(credentials: WebpayPlusCredentials, token: string, amount: number): Promise<{ type: string; refundedAmount: number }> {
    const body = await this.request(credentials, "POST", `/transactions/${encodeURIComponent(token)}/refunds`, { amount });
    const parsed = parse(refundResponse, body);
    return { type: parsed.type, refundedAmount: parsed.nullified_amount ?? amount };
  }

  private async request(credentials: WebpayPlusCredentials, method: string, path: string, payload: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${WEBPAY_BASE_URLS[credentials.environment]}${API_PATH}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "Tbk-Api-Key-Id": credentials.commerceCode,
          "Tbk-Api-Key-Secret": credentials.apiKeySecret,
        },
        body: payload === undefined ? (method === "PUT" ? "{}" : undefined) : JSON.stringify(payload),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      if (controller.signal.aborted) throw new PaymentGatewayError("timeout", true, "Transbank no respondió a tiempo.");
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

/**
 * Simulador de Webpay Plus para las pruebas (sin red). Reproduce lo que importa del comportamiento real: las transacciones son de un
 * comercio (otras credenciales no las ven), se confirman UNA sola vez y el monto confirmado es el de la transacción.
 */
export class FakeWebpayPlus implements WebpayPlusLike {
  readonly created: Array<WebpayPlusCreateInput & { token: string; commerceCode: string }> = [];
  readonly refunds: Array<{ token: string; amount: number }> = [];
  failNextCreate = false;
  /** Códigos de comercio que Transbank rechaza (credenciales inválidas). */
  readonly rejectedCommerceCodes = new Set<string>();
  private readonly outcomes = new Map<string, { status: string; responseCode: number; amount?: number; commerceCode?: string }>();
  private readonly committed = new Set<string>();

  /** ¿Ya se confirmó esta transacción? Una confirmación consume el token: las pruebas verifican que nadie confirme una ajena. */
  isCommitted(token: string): boolean {
    return this.committed.has(token);
  }

  async create(credentials: WebpayPlusCredentials, input: WebpayPlusCreateInput): Promise<WebpayPlusTransaction> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new PaymentGatewayError("unavailable", true, "Simulación: Transbank caído.");
    }
    if (!/^\d{12}$/.test(credentials.commerceCode) || this.rejectedCommerceCodes.has(credentials.commerceCode)) {
      throw new PaymentGatewayError("auth_error", false, "Credenciales de Transbank rechazadas.");
    }
    if (input.amount <= 0 || !Number.isInteger(input.amount)) throw new PaymentGatewayError("rejected", false, "Monto inválido.");
    if (!/^[A-Za-z0-9]{1,26}$/.test(input.buyOrder)) throw new PaymentGatewayError("rejected", false, "Orden de compra inválida.");
    const token = `01ab${randomBytes(30).toString("hex")}`;
    this.created.push({ ...input, token, commerceCode: credentials.commerceCode });
    return { token, url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction" };
  }

  /** Simula lo que hace el comprador en Webpay (paga, o la tarjeta es rechazada). */
  pay(token: string, outcome: { status?: string; responseCode?: number; amount?: number } = {}): void {
    if (!this.created.some((item) => item.token === token)) throw new Error(`Sin transacción para ${token}`);
    this.outcomes.set(token, { status: outcome.status ?? "AUTHORIZED", responseCode: outcome.responseCode ?? 0, amount: outcome.amount });
  }

  private resultFor(credentials: WebpayPlusCredentials, token: string): WebpayPlusResult {
    const transaction = this.created.find((item) => item.token === token && item.commerceCode === credentials.commerceCode);
    // Transbank responde 422 «not found» a un token que no es de este comercio.
    if (!transaction) throw new PaymentGatewayError("not_found", false, "Transacción desconocida.");
    const outcome = this.outcomes.get(token);
    if (!outcome) throw new PaymentGatewayError("rejected", false, "La transacción aún no fue pagada.");
    return {
      status: outcome.status,
      responseCode: outcome.responseCode,
      amount: outcome.amount ?? transaction.amount,
      buyOrder: transaction.buyOrder,
      sessionId: transaction.sessionId,
      authorizationCode: outcome.status === "AUTHORIZED" ? "1213" : null,
      cardLast4: "6623",
      transactionDate: new Date(),
    };
  }

  async commit(credentials: WebpayPlusCredentials, token: string): Promise<WebpayPlusResult> {
    const result = this.resultFor(credentials, token);
    if (this.committed.has(token)) throw new PaymentGatewayError("rejected", false, "La transacción ya fue confirmada.");
    this.committed.add(token);
    return result;
  }

  async status(credentials: WebpayPlusCredentials, token: string): Promise<WebpayPlusResult> {
    return this.resultFor(credentials, token);
  }

  async refund(credentials: WebpayPlusCredentials, token: string, amount: number): Promise<{ type: string; refundedAmount: number }> {
    this.resultFor(credentials, token);
    this.refunds.push({ token, amount });
    return { type: "REVERSED", refundedAmount: amount };
  }
}
