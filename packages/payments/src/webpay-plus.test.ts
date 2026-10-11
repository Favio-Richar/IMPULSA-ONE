import { describe, expect, it, vi } from "vitest";
import {
  FakeWebpayPlus,
  PaymentGatewayError,
  WEBPAY_PLUS_INTEGRATION_CREDENTIALS,
  WebpayPlus,
  newWebpayPlusBuyOrder,
  webpayPlusBuyOrder,
  webpayPlusMismatches,
  type WebpayPlusCredentials,
  type WebpayPlusResult,
} from "./index.js";

const CREDENTIALS: WebpayPlusCredentials = { ...WEBPAY_PLUS_INTEGRATION_CREDENTIALS, environment: "integration" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("orden de compra", () => {
  it("lleva el prefijo y respeta los 26 caracteres de Transbank", () => {
    expect(webpayPlusBuyOrder("abc123")).toBe("Mabc123");
    expect(newWebpayPlusBuyOrder()).toMatch(/^M[0-9a-f]{24}$/);
    expect(newWebpayPlusBuyOrder().length).toBeLessThanOrEqual(26);
    expect(newWebpayPlusBuyOrder()).not.toBe(newWebpayPlusBuyOrder());
  });

  it("rechaza caracteres que Transbank no admite o un núcleo demasiado largo", () => {
    expect(() => webpayPlusBuyOrder("con-guion")).toThrow();
    expect(() => webpayPlusBuyOrder("a".repeat(26))).toThrow();
    expect(() => webpayPlusBuyOrder("")).toThrow();
  });
});

describe("WebpayPlus (REST)", () => {
  it("crea la transacción con las credenciales del comercio y el cuerpo exacto, en el ambiente pedido", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ token: "tok-123", url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction" }));
    const gateway = new WebpayPlus(fetchMock as unknown as typeof fetch);
    const tx = await gateway.create(CREDENTIALS, { buyOrder: "Mabc", sessionId: "s1", amount: 9990, returnUrl: "https://api.test/retorno" });
    expect(tx).toEqual({ token: "tok-123", url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Tbk-Api-Key-Id": CREDENTIALS.commerceCode, "Tbk-Api-Key-Secret": CREDENTIALS.apiKeySecret });
    expect(JSON.parse(init.body as string)).toEqual({ buy_order: "Mabc", session_id: "s1", amount: 9990, return_url: "https://api.test/retorno" });
    expect(init.redirect).toBe("error");
  });

  it("usa el ambiente de producción solo cuando se pide", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ token: "t", url: "https://webpay3g.transbank.cl/x" }));
    await new WebpayPlus(fetchMock as unknown as typeof fetch).create({ ...CREDENTIALS, environment: "production" }, { buyOrder: "M1", sessionId: "s", amount: 1, returnUrl: "https://a.test/r" });
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/^https:\/\/webpay3g\.transbank\.cl\//);
  });

  it("confirma con PUT y devuelve solo los últimos 4 dígitos de la tarjeta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        status: "AUTHORIZED",
        response_code: 0,
        amount: 9990,
        buy_order: "Mabc",
        session_id: "s1",
        authorization_code: "1213",
        card_detail: { card_number: "6623" },
        transaction_date: "2026-10-11T12:00:00.000Z",
      }),
    );
    const result = await new WebpayPlus(fetchMock as unknown as typeof fetch).commit(CREDENTIALS, "tok-123");
    expect(result).toMatchObject({ status: "AUTHORIZED", responseCode: 0, amount: 9990, buyOrder: "Mabc", authorizationCode: "1213", cardLast4: "6623" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/transactions\/tok-123$/);
    expect(init.method).toBe("PUT");
  });

  it("traduce los errores de Transbank a códigos estables, sin filtrar la llave", async () => {
    const make = (status: number, body: unknown) => new WebpayPlus(vi.fn().mockResolvedValue(json(body, status)) as unknown as typeof fetch);
    const input = { buyOrder: "M1", sessionId: "s", amount: 1, returnUrl: "https://a.test/r" };
    await expect(make(401, { error_message: "Not Authorized" }).create(CREDENTIALS, input)).rejects.toMatchObject({ code: "auth_error", retryable: false });
    await expect(make(422, { error_message: "Invalid value for parameter: token not found" }).commit(CREDENTIALS, "t")).rejects.toMatchObject({ code: "not_found" });
    await expect(make(422, { error_message: "Transaction already locked by another process" }).commit(CREDENTIALS, "t")).rejects.toMatchObject({ code: "rejected" });
    await expect(make(503, {}).create(CREDENTIALS, input)).rejects.toMatchObject({ code: "unavailable", retryable: true });
    await expect(make(200, { raro: true }).commit(CREDENTIALS, "t")).rejects.toMatchObject({ code: "invalid_response" });
    try {
      await make(401, { error_message: "no" }).create(CREDENTIALS, input);
    } catch (error) {
      expect(String(error)).not.toContain(CREDENTIALS.apiKeySecret);
    }
  });

  it("un corte de red o un tiempo agotado son errores reintentables", async () => {
    const down = new WebpayPlus(vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch);
    await expect(down.status(CREDENTIALS, "t")).rejects.toMatchObject({ code: "unavailable", retryable: true });
    const slow = new WebpayPlus(
      ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("abortado"))))) as unknown as typeof fetch,
      10,
    );
    await expect(slow.status(CREDENTIALS, "t")).rejects.toMatchObject({ code: "timeout", retryable: true });
  });
});

describe("webpayPlusMismatches", () => {
  const ok: WebpayPlusResult = { status: "AUTHORIZED", responseCode: 0, amount: 5000, buyOrder: "Mabc", sessionId: "s", authorizationCode: "1", cardLast4: null, transactionDate: null };

  it("una transacción autorizada con la orden y el monto esperados corresponde", () => {
    expect(webpayPlusMismatches(ok, { buyOrder: "Mabc", amount: 5000 })).toEqual([]);
  });

  it("señala cada diferencia: estado, código, orden de compra y monto", () => {
    expect(webpayPlusMismatches({ ...ok, status: "FAILED" }, { buyOrder: "Mabc", amount: 5000 })).toContain("status");
    expect(webpayPlusMismatches({ ...ok, responseCode: -1 }, { buyOrder: "Mabc", amount: 5000 })).toContain("response_code");
    expect(webpayPlusMismatches(ok, { buyOrder: "Motra", amount: 5000 })).toContain("buy_order");
    expect(webpayPlusMismatches(ok, { buyOrder: "Mabc", amount: 4999 })).toContain("amount");
  });
});

describe("FakeWebpayPlus", () => {
  it("una transacción se confirma una sola vez y un token ajeno no se ve", async () => {
    const fake = new FakeWebpayPlus();
    const tx = await fake.create(CREDENTIALS, { buyOrder: "Mabc", sessionId: "s", amount: 1000, returnUrl: "https://a.test/r" });
    await expect(fake.commit(CREDENTIALS, tx.token)).rejects.toBeInstanceOf(PaymentGatewayError); // aún no pagó
    fake.pay(tx.token);
    expect((await fake.commit(CREDENTIALS, tx.token)).status).toBe("AUTHORIZED");
    await expect(fake.commit(CREDENTIALS, tx.token)).rejects.toMatchObject({ code: "rejected" });
    expect((await fake.status(CREDENTIALS, tx.token)).amount).toBe(1000);
    await expect(fake.status({ ...CREDENTIALS, commerceCode: "597055555599" }, tx.token)).rejects.toMatchObject({ code: "not_found" });
  });

  it("valida lo mismo que Transbank: monto entero positivo y orden alfanumérica", async () => {
    const fake = new FakeWebpayPlus();
    const input = { buyOrder: "Mabc", sessionId: "s", amount: 1000, returnUrl: "https://a.test/r" };
    await expect(fake.create(CREDENTIALS, { ...input, amount: 0 })).rejects.toMatchObject({ code: "rejected" });
    await expect(fake.create(CREDENTIALS, { ...input, amount: 10.5 })).rejects.toMatchObject({ code: "rejected" });
    await expect(fake.create(CREDENTIALS, { ...input, buyOrder: "con-guion" })).rejects.toMatchObject({ code: "rejected" });
  });
});
