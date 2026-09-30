import { describe, expect, it } from "vitest";
import { checkoutPaymentMismatches, checkoutSupportsCurrency, FakeMercadoPagoCheckout, MercadoPagoCheckout } from "./index.js";

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift()!;
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const TOKEN = "APP_USR-token-del-negocio-000000";
const input = {
  externalReference: "3f1c2d4e-0000-4000-8000-000000000001",
  title: "Torta de chocolate",
  quantity: 2,
  unitPrice: 12_990,
  currency: "CLP",
  payerEmail: "ana@example.com",
  payerName: "Ana Pérez",
  notificationUrl: "https://api.impulza.test/api/v1/payments/mercadopago/orders/3f1c/webhook",
  backUrl: "https://impulza.test/pedido/tok",
  expiresAt: new Date("2026-10-01T12:00:00Z"),
};

describe("MercadoPagoCheckout", () => {
  it("crea la preferencia con el token del negocio, el pedido como referencia y clave de idempotencia", async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { id: "123-abc", init_point: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123-abc", sandbox_init_point: "https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=123-abc" } }]);
    const preference = await new MercadoPagoCheckout({}, impl).createPreference(TOKEN, input, true);
    expect(preference).toEqual({ id: "123-abc", checkoutUrl: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123-abc" });
    expect(calls[0]!.url).toBe("https://api.mercadopago.com/checkout/preferences");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["x-idempotency-key"]).toBe(`pref-${input.externalReference}`);
    expect(calls[0]!.init.redirect).toBe("error");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      items: [{ id: input.externalReference, title: "Torta de chocolate", quantity: 2, unit_price: 12_990, currency_id: "CLP" }],
      payer: { email: "ana@example.com" },
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      back_urls: { success: input.backUrl, failure: input.backUrl, pending: input.backUrl },
      auto_return: "approved",
      expires: true,
      expiration_date_to: "2026-10-01T12:00:00.000Z",
    });
  });

  it("con credenciales de prueba lleva al entorno de pruebas de Mercado Pago", async () => {
    const { impl } = fakeFetch([{ status: 201, body: { id: "1", init_point: "https://www.mercadopago.cl/x", sandbox_init_point: "https://sandbox.mercadopago.cl/x" } }]);
    expect((await new MercadoPagoCheckout({}, impl).createPreference(TOKEN, input, false)).checkoutUrl).toBe("https://sandbox.mercadopago.cl/x");
  });

  it("no crea preferencias en monedas que Mercado Pago Chile no cobra", async () => {
    const { impl, calls } = fakeFetch([]);
    await expect(new MercadoPagoCheckout({}, impl).createPreference(TOKEN, { ...input, currency: "USD" }, true)).rejects.toMatchObject({ code: "rejected" });
    expect(calls).toHaveLength(0);
    expect(checkoutSupportsCurrency("CLP")).toBe(true);
    expect(checkoutSupportsCurrency("ARS")).toBe(false);
  });

  it("consulta el pago y lo normaliza (monto entero, cuenta receptora, fecha)", async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: { id: 998877, status: "approved", status_detail: "accredited", external_reference: "ped-1", transaction_amount: 25980, currency_id: "CLP", collector_id: 445566, date_approved: "2026-09-30T15:00:00.000-03:00", live_mode: false } },
    ]);
    const payment = await new MercadoPagoCheckout({}, impl).getPayment(TOKEN, "998877");
    expect(payment).toMatchObject({ id: "998877", status: "approved", externalReference: "ped-1", amount: 25_980, currency: "CLP", collectorId: "445566", liveMode: false });
    expect(payment.approvedAt?.toISOString()).toBe("2026-09-30T18:00:00.000Z");
    expect(calls[0]!.url).toBe("https://api.mercadopago.com/v1/payments/998877");
  });

  it("traduce los errores de Mercado Pago a códigos estables", async () => {
    const checkout = (status: number) => new MercadoPagoCheckout({}, fakeFetch([{ status, body: { message: "x" } }]).impl);
    await expect(checkout(401).getPayment(TOKEN, "1")).rejects.toMatchObject({ code: "auth_error", retryable: false });
    await expect(checkout(404).getPayment(TOKEN, "1")).rejects.toMatchObject({ code: "not_found" });
    await expect(checkout(400).createPreference(TOKEN, input, true)).rejects.toMatchObject({ code: "rejected" });
    await expect(checkout(503).getPayment(TOKEN, "1")).rejects.toMatchObject({ code: "unavailable", retryable: true });
    await expect(checkout(200).getPayment(TOKEN, "1")).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("checkoutPaymentMismatches", () => {
  const payment = { id: "1", status: "approved", statusDetail: null, externalReference: "ref-1", amount: 5_000, currency: "CLP", collectorId: "77", approvedAt: null, liveMode: false };
  const expected = { externalReference: "ref-1", collectorId: "77", amount: 5_000, currency: "CLP" };

  it("coincide solo si referencia, cuenta receptora, monto y moneda son los esperados", () => {
    expect(checkoutPaymentMismatches(payment, expected)).toEqual([]);
    expect(checkoutPaymentMismatches({ ...payment, externalReference: "ref-2" }, expected)).toEqual(["reference"]);
    expect(checkoutPaymentMismatches({ ...payment, collectorId: null }, expected)).toEqual(["collector"]);
    expect(checkoutPaymentMismatches({ ...payment, amount: 4_999 }, expected)).toEqual(["amount"]);
    expect(checkoutPaymentMismatches({ ...payment, currency: "USD" }, expected)).toEqual(["amount"]);
  });
});

describe("FakeMercadoPagoCheckout", () => {
  it("un token no ve los pagos de otra cuenta, como en Mercado Pago", async () => {
    const fake = new FakeMercadoPagoCheckout();
    await fake.createPreference(TOKEN, input);
    const id = fake.pay(input.externalReference, { collectorId: "1" });
    expect((await fake.getPayment(TOKEN, id)).amount).toBe(25_980);
    await expect(fake.getPayment("APP_USR-otro-negocio", id)).rejects.toMatchObject({ code: "not_found" });
  });
});
