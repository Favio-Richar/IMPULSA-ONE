import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { POST } = await import("./route.js");
const params = { params: Promise.resolve({ token: "abc.def" }) };

describe("ruta de baja de campañas (F5.6)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reenvía la baja (también la de un clic, sin JSON) con la cabecera anti-CSRF y devuelve el estado tal cual", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ organizationName: "Tienda", maskedEmail: "an•••@x.cl", unsubscribed: true }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      new Request("https://impulza.test/api/unsubscribe/abc.def", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
      params,
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/public/unsubscribe/abc.def");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("impulza-one");
    expect(init.body).toBeUndefined();
  });

  it("si la API no responde, 502 con un mensaje claro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await POST(new Request("https://impulza.test/api/unsubscribe/abc.def", { method: "POST" }), params)).status).toBe(502);
  });
});
