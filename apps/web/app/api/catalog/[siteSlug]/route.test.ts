import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { GET } = await import("./route.js");
const { POST } = await import("./orders/route.js");
const { POST: CHECK_COUPON } = await import("./coupons/check/route.js");
const { POST: CART_ORDER } = await import("./cart/orders/route.js");
const { POST: CART_COUPON } = await import("./cart/coupons/check/route.js");
const params = { params: Promise.resolve({ siteSlug: "tienda-lumen" }) };

describe("rutas del catálogo del sitio público (F5.5)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reenvía el pedido a la API con la cabecera anti-CSRF y devuelve su estado tal cual", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ message: "No quedan suficientes unidades de ese producto." }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      new Request("https://impulza.test/api/catalog/tienda-lumen/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: "p1" }) }),
      params,
    );
    expect(response.status).toBe(409);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/public/sites/tienda-lumen/catalog/orders");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("impulza-one");
  });

  it("un cuerpo que no es JSON no llega a la API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("https://impulza.test/api/catalog/tienda-lumen/orders", { method: "POST", body: "no-json" }), params);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si la API no responde, 502 con un mensaje para el visitante y sin registrar sus datos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(
      new Request("https://impulza.test/api/catalog/tienda-lumen/orders", { method: "POST", body: JSON.stringify({ email: "ana@example.com" }) }),
      params,
    );
    expect(response.status).toBe(502);
    expect(JSON.stringify(log.mock.calls)).not.toContain("ana@example.com");
    expect((await GET(new Request("https://impulza.test/api/catalog/tienda-lumen"), params)).status).toBe(502);
  });

  it("reenvía la prueba de un código a la API (F7.8b) y devuelve su respuesta uniforme tal cual", async () => {
    const invalid = { statusCode: 422, code: "COUPON_INVALID", message: "Ese código no es válido." };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(invalid, { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await CHECK_COUPON(
      new Request("https://impulza.test/api/catalog/tienda-lumen/coupons/check", { method: "POST", body: JSON.stringify({ code: "X", productId: "p1", quantity: 1 }) }),
      params,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual(invalid);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/public/sites/tienda-lumen/catalog/coupons/check");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("impulza-one");
    expect((await CHECK_COUPON(new Request("https://impulza.test/x", { method: "POST", body: "no-json" }), params)).status).toBe(400);
  });

  it("el carrito (F7.8c) reenvía el pedido y la prueba de código a sus rutas de la API, sin tocar el cuerpo", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ ok: true }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const lines = [{ productId: "p1", quantity: 2 }];
    expect((await CART_ORDER(new Request("https://impulza.test/x", { method: "POST", body: JSON.stringify({ lines }) }), params)).status).toBe(201);
    expect((await CART_COUPON(new Request("https://impulza.test/x", { method: "POST", body: JSON.stringify({ code: "X", lines }) }), params)).status).toBe(201);
    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls).toEqual([
      "http://api.test/api/v1/public/sites/tienda-lumen/catalog/cart/orders",
      "http://api.test/api/v1/public/sites/tienda-lumen/catalog/cart/coupons/check",
    ]);
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ lines });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await CART_ORDER(new Request("https://impulza.test/x", { method: "POST", body: JSON.stringify({ lines }) }), params)).status).toBe(502);
    expect((await CART_ORDER(new Request("https://impulza.test/x", { method: "POST", body: "no-json" }), params)).status).toBe(400);
  });
});
