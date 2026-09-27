import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { GET } = await import("./route.js");
const { POST } = await import("./orders/route.js");
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
});
