import { describe, expect, it } from "vitest";
import {
  buyOrderFor,
  customerRefFor,
  FakeRecurringGateway,
  graceEndsAt,
  nextRetryAt,
  oneclickBuyOrders,
  PaymentGatewayError,
  periodEnd,
  splitVat,
  WEBPAY_INTEGRATION_CREDENTIALS,
  WebpayOneclickGateway,
  webpayConfigFromEnv,
  withinWithdrawalWindow,
} from "./index.js";

describe("splitVat", () => {
  it("neto + IVA es siempre exactamente el total", () => {
    for (const total of [0, 1, 7_990, 19_990, 79_900, 199_900, 123_457]) {
      const { net, vat } = splitVat(total);
      expect(net + vat).toBe(total);
    }
    expect(splitVat(7_990)).toEqual({ net: 6_714, vat: 1_276, total: 7_990 });
  });

  it("rechaza montos que no son pesos enteros", () => {
    expect(() => splitVat(10.5)).toThrow();
    expect(() => splitVat(-1)).toThrow();
  });
});

describe("periodEnd", () => {
  it("mensual: mismo día del mes siguiente", () => {
    expect(periodEnd(new Date("2026-09-15T12:00:00Z"), "MONTHLY").toISOString()).toBe("2026-10-15T12:00:00.000Z");
  });

  it("mensual desde el 31: último día del mes corto, sin saltarse febrero", () => {
    expect(periodEnd(new Date("2027-01-31T10:00:00Z"), "MONTHLY").toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(periodEnd(new Date("2028-01-31T10:00:00Z"), "MONTHLY").toISOString()).toBe("2028-02-29T10:00:00.000Z");
  });

  it("anual: un año después, y el 29 de febrero cae en el 28", () => {
    expect(periodEnd(new Date("2028-02-29T00:00:00Z"), "YEARLY").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
});

describe("buyOrderFor", () => {
  const start = new Date("2026-10-01T00:00:00Z");

  it("es determinista: el mismo período e intento dan la misma orden", () => {
    expect(buyOrderFor("sub-1", start, 1)).toBe(buyOrderFor("sub-1", start, 1));
  });

  it("cambia con la suscripción, el período o el intento", () => {
    const base = buyOrderFor("sub-1", start, 1);
    expect(buyOrderFor("sub-2", start, 1)).not.toBe(base);
    expect(buyOrderFor("sub-1", new Date("2026-11-01T00:00:00Z"), 1)).not.toBe(base);
    expect(buyOrderFor("sub-1", start, 2)).not.toBe(base);
  });

  it("cabe en Transbank con el prefijo del mall (≤ 26, alfanumérica)", () => {
    const orders = oneclickBuyOrders(buyOrderFor("sub-1", start, 1));
    expect(orders.parent).toMatch(/^P[0-9A-Z]{24}$/);
    expect(orders.child).toMatch(/^C[0-9A-Z]{24}$/);
    expect(orders.parent).not.toBe(orders.child);
  });
});

describe("morosidad y retracto", () => {
  const due = new Date("2026-10-01T00:00:00Z");

  it("reintenta los días 1, 3 y 6 y después se agota", () => {
    expect(nextRetryAt(due, 1)?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(nextRetryAt(due, 2)?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(nextRetryAt(due, 3)?.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(nextRetryAt(due, 4)).toBeNull();
    expect(graceEndsAt(due).toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("el retracto vale 10 días desde el primer cobro", () => {
    expect(withinWithdrawalWindow(due, new Date("2026-10-11T00:00:00Z"))).toBe(true);
    expect(withinWithdrawalWindow(due, new Date("2026-10-11T00:00:01Z"))).toBe(false);
  });

  it("la referencia de cliente es el id de organización sin guiones", () => {
    expect(customerRefFor("0b9f3a52-1111-4222-8333-944455556666")).toBe("0b9f3a5211114222833394445555" + "6666");
  });
});

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("sin respuesta preparada");
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function gateway(fetchImpl: typeof fetch) {
  return new WebpayOneclickGateway({ environment: "integration", ...WEBPAY_INTEGRATION_CREDENTIALS }, fetchImpl);
}

describe("WebpayOneclickGateway", () => {
  it("inicia la inscripción con credenciales en cabeceras y pide POST con TBK_TOKEN", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { token: "tok123", url_webpay: "https://webpay3gint.transbank.cl/webpayserver/bp_multicode_inscription.cgi" } }]);
    const redirect = await gateway(impl).startEnrollment({ customerRef: "org1", email: "a@b.cl", returnUrl: "https://app/retorno" });

    expect(redirect).toMatchObject({ method: "POST", fields: { TBK_TOKEN: "tok123" }, token: "tok123" });
    expect(calls[0]!.url).toBe("https://webpay3gint.transbank.cl/rswebpaytransaction/api/oneclick/v1.2/inscriptions");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Tbk-Api-Key-Id"]).toBe("597055555541");
    expect(calls[0]!.init.redirect).toBe("error");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ username: "org1", email: "a@b.cl", response_url: "https://app/retorno" });
  });

  it("al confirmar guarda solo marca y últimos 4 dígitos", async () => {
    const { impl } = fakeFetch([
      { status: 200, body: { response_code: 0, tbk_user: "u-1", authorization_code: "1213", card_type: "Visa", card_number: "XXXXXXXXXXXX6623" } },
    ]);
    const result = await gateway(impl).finishEnrollment("tok123");
    expect(result).toEqual({ approved: true, responseCode: 0, paymentMethodRef: "u-1", cardBrand: "Visa", cardLast4: "6623" });
  });

  it("una inscripción rechazada no devuelve referencia", async () => {
    const { impl } = fakeFetch([{ status: 200, body: { response_code: -1, tbk_user: null } }]);
    const result = await gateway(impl).finishEnrollment("tok123");
    expect(result.approved).toBe(false);
    expect(result.paymentMethodRef).toBeNull();
  });

  it("cobra con órdenes P/C derivadas y en una sola cuota", async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: { buy_order: "PX", details: [{ status: "AUTHORIZED", response_code: 0, authorization_code: "1213", amount: 7990 }] } },
    ]);
    const result = await gateway(impl).charge({ customerRef: "org1", paymentMethodRef: "u-1", buyOrder: "ABC", amount: 7_990 });

    expect(result).toEqual({ status: "approved", responseCode: 0, authorizationCode: "1213" });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      username: "org1",
      tbk_user: "u-1",
      buy_order: "PABC",
      details: [{ commerce_code: "597055555542", buy_order: "CABC", amount: 7_990, installments_number: 1 }],
    });
  });

  it("un cobro con response_code distinto de 0 es rechazado", async () => {
    const { impl } = fakeFetch([
      { status: 200, body: { buy_order: "PX", details: [{ status: "FAILED", response_code: -1, authorization_code: null, amount: 7990 }] } },
    ]);
    expect((await gateway(impl).charge({ customerRef: "o", paymentMethodRef: "u", buyOrder: "ABC", amount: 1 })).status).toBe("rejected");
  });

  it("traduce errores HTTP a códigos estables", async () => {
    const cases: Array<[number, string, boolean]> = [
      [401, "auth_error", false],
      [422, "rejected", false],
      [500, "unavailable", true],
    ];
    for (const [status, code, retryable] of cases) {
      const { impl } = fakeFetch([{ status, body: { error_message: "detalle" } }]);
      const error = await gateway(impl).startEnrollment({ customerRef: "o", email: "a@b.cl", returnUrl: "https://x" }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaymentGatewayError);
      expect(error).toMatchObject({ code, retryable });
    }
  });

  it("una respuesta con forma inesperada no se acepta", async () => {
    const { impl } = fakeFetch([{ status: 200, body: { algo: "raro" } }]);
    await expect(gateway(impl).finishEnrollment("t")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("chargeStatus devuelve null si Transbank no conoce la orden", async () => {
    const { impl } = fakeFetch([{ status: 404, body: { error_message: "not found" } }]);
    expect(await gateway(impl).chargeStatus("ABC")).toBeNull();
  });

  it("chargeStatus: el 422 'buy order not found' real de Transbank también es 'no la conoce'", async () => {
    // Respuesta literal del ambiente de integración para una orden inexistente.
    const { impl } = fakeFetch([{ status: 422, body: { error_message: "Invalid value for parameter: buy order not found" } }]);
    expect(await gateway(impl).chargeStatus("ABC")).toBeNull();
  });

  it("un 422 de otra causa sigue siendo un rechazo, no 'no encontrada'", async () => {
    const { impl } = fakeFetch([{ status: 422, body: { error_message: "Invalid value for parameter: amount" } }]);
    await expect(gateway(impl).chargeStatus("ABC")).rejects.toMatchObject({ code: "rejected" });
  });
});

describe("FakeRecurringGateway", () => {
  it("nunca cobra dos veces la misma orden, aunque la red haya fallado", async () => {
    const fake = new FakeRecurringGateway();
    fake.nextCharges = ["network"];
    await expect(fake.charge({ customerRef: "o", paymentMethodRef: "u", buyOrder: "A", amount: 10 })).rejects.toMatchObject({ code: "timeout" });
    expect((await fake.chargeStatus("A"))?.status).toBe("approved");
    expect((await fake.charge({ customerRef: "o", paymentMethodRef: "u", buyOrder: "A", amount: 10 })).status).toBe("rejected");
    expect(fake.charges.size).toBe(1);
  });
});

describe("webpayConfigFromEnv", () => {
  const full = {
    WEBPAY_ENVIRONMENT: "integration" as const,
    WEBPAY_COMMERCE_CODE: "597055555541",
    WEBPAY_CHILD_COMMERCE_CODE: "597055555542",
    WEBPAY_API_KEY_SECRET: WEBPAY_INTEGRATION_CREDENTIALS.apiKeySecret,
  };

  it("sin variables: la pasarela no se ofrece", () => {
    expect(webpayConfigFromEnv({ WEBPAY_ENVIRONMENT: undefined, WEBPAY_COMMERCE_CODE: undefined, WEBPAY_CHILD_COMMERCE_CODE: undefined, WEBPAY_API_KEY_SECRET: undefined })).toBeNull();
  });

  it("completas: configuración lista", () => {
    expect(webpayConfigFromEnv(full)).toMatchObject({ environment: "integration", commerceCode: "597055555541", childCommerceCode: "597055555542" });
  });

  it("a medias: detiene el arranque", () => {
    expect(() => webpayConfigFromEnv({ ...full, WEBPAY_API_KEY_SECRET: undefined })).toThrow(/incompleta/);
  });
});
