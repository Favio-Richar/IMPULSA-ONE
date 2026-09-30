import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MercadoPagoGateway, mercadoPagoConfigFromEnv, PaymentGatewayError, verifyMercadoPagoSignature } from "./index.js";

const SECRET = "clave-secreta-de-firma-0123456789";

function sign(manifest: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

describe("verifyMercadoPagoSignature", () => {
  const ts = "1704908010";
  const good = `ts=${ts},v1=${sign(`id:123456;request-id:req-1;ts:${ts};`)}`;

  it("acepta la firma correcta", () => {
    expect(verifyMercadoPagoSignature({ signature: good, requestId: "req-1", dataId: "123456", secret: SECRET })).toBe(true);
  });

  it("usa el data.id en minúsculas, como indica Mercado Pago", () => {
    const signature = `ts=${ts},v1=${sign(`id:abc123;request-id:req-1;ts:${ts};`)}`;
    expect(verifyMercadoPagoSignature({ signature, requestId: "req-1", dataId: "ABC123", secret: SECRET })).toBe(true);
  });

  it("rechaza si cambia el recurso, el request-id, el ts o la clave", () => {
    expect(verifyMercadoPagoSignature({ signature: good, requestId: "req-1", dataId: "999999", secret: SECRET })).toBe(false);
    expect(verifyMercadoPagoSignature({ signature: good, requestId: "req-2", dataId: "123456", secret: SECRET })).toBe(false);
    expect(verifyMercadoPagoSignature({ signature: good.replace(`ts=${ts}`, "ts=1704908011"), requestId: "req-1", dataId: "123456", secret: SECRET })).toBe(false);
    expect(verifyMercadoPagoSignature({ signature: good, requestId: "req-1", dataId: "123456", secret: "otra-clave-cualquiera-00000000000" })).toBe(false);
  });

  it("rechaza firmas ausentes o mal formadas sin lanzar", () => {
    for (const signature of [undefined, "", "v1=abc", `ts=${ts}`, `ts=${ts},v1=zz`, `ts=${ts},v1=${"a".repeat(63)}`]) {
      expect(verifyMercadoPagoSignature({ signature, requestId: "req-1", dataId: "123456", secret: SECRET })).toBe(false);
    }
  });

  it("omite del manifiesto lo que no vino (sin request-id)", () => {
    const signature = `ts=${ts},v1=${sign(`id:123456;ts:${ts};`)}`;
    expect(verifyMercadoPagoSignature({ signature, requestId: undefined, dataId: "123456", secret: SECRET })).toBe(true);
  });
});

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

describe("MercadoPagoGateway", () => {
  const config = { accessToken: "APP_USR-token-de-prueba-000000", webhookSecret: SECRET };

  it("crea la suscripción pendiente en CLP, con el token en la cabecera y sin seguir redirecciones", async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { id: "2c93808", status: "pending", external_reference: "chk-1", init_point: "https://www.mercadopago.cl/subscriptions/checkout?preapproval_id=2c93808" } }]);
    const result = await new MercadoPagoGateway(config, impl).createSubscription({
      reason: "Impulza One — plan Profesional",
      externalReference: "chk-1",
      payerEmail: "dueno@negocio.cl",
      amount: 7_990,
      frequencyMonths: 1,
      backUrl: "https://api.impulza.test/api/v1/billing/mercadopago/return",
    });
    expect(result).toMatchObject({ id: "2c93808", status: "pending", externalReference: "chk-1" });
    expect(calls[0]!.url).toBe("https://api.mercadopago.com/preapproval");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer APP_USR-token-de-prueba-000000");
    expect(calls[0]!.init.redirect).toBe("error");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      status: "pending",
      external_reference: "chk-1",
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 7_990, currency_id: "CLP" },
    });
  });

  it("lee una cuota con su pago y redondea a pesos", async () => {
    const { impl } = fakeFetch([
      { status: 200, body: { id: 6114264375, preapproval_id: "2c93808", status: "processed", transaction_amount: 7990.0, currency_id: "CLP", debit_date: "2026-10-01T10:00:00.000-03:00", payment: { id: 999, status: "approved" } } },
    ]);
    const charge = await new MercadoPagoGateway(config, impl).getAuthorizedPayment("6114264375");
    expect(charge).toMatchObject({ id: "6114264375", preapprovalId: "2c93808", amount: 7_990, payment: { id: "999", status: "approved" } });
    expect(charge.debitDate?.toISOString()).toBe("2026-10-01T13:00:00.000Z");
  });

  it("cancela con PUT status cancelled", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { id: "2c93808", status: "cancelled" } }]);
    await new MercadoPagoGateway(config, impl).cancelSubscription("2c93808");
    expect(calls[0]!.init.method).toBe("PUT");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ status: "cancelled" });
  });

  it("traduce errores a códigos estables y no acepta respuestas raras", async () => {
    const auth = fakeFetch([{ status: 401, body: { message: "invalid access token" } }]);
    await expect(new MercadoPagoGateway(config, auth.impl).getSubscription("x")).rejects.toMatchObject({ code: "auth_error" });
    const weird = fakeFetch([{ status: 200, body: { nada: true } }]);
    const error = await new MercadoPagoGateway(config, weird.impl).getSubscription("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentGatewayError);
    expect(error).toMatchObject({ code: "invalid_response" });
  });
});

describe("mercadoPagoConfigFromEnv", () => {
  it("ninguna, las dos, o no arranca", () => {
    expect(mercadoPagoConfigFromEnv({})).toBeNull();
    expect(mercadoPagoConfigFromEnv({ MERCADOPAGO_ACCESS_TOKEN: "APP_USR-00000000000000000000", MERCADOPAGO_WEBHOOK_SECRET: SECRET })).toMatchObject({ webhookSecret: SECRET });
    expect(() => mercadoPagoConfigFromEnv({ MERCADOPAGO_ACCESS_TOKEN: "APP_USR-00000000000000000000" })).toThrow(/incompleta/);
  });
});
