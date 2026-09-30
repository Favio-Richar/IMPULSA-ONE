import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { POST } = await import("./route.js");

const call = (token = "ped.firma") => POST(new Request("https://impulza.test/pedido/descarga/x/archivo", { method: "POST" }), { params: Promise.resolve({ token }) });

describe("POST /pedido/descarga/:token/archivo (F5.11b)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pide la URL firmada a la API (POST, anti-CSRF) y redirige a ella sin referer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ url: "https://bucket.test/firmada?x=1", expiresAt: "2030-01-01T00:00:00Z", downloadsLeft: 19 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await call();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://bucket.test/firmada?x=1");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/public/downloads/ped.firma/url");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("impulza-one");
  });

  it("si no se entrega, vuelve a la página con el motivo (nunca uno inventado)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "limit_reached", message: "..." }, { status: 409 })));
    expect((await call()).headers.get("location")).toBe("/pedido/descarga/ped.firma?error=limit_reached");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "<script>" }, { status: 409 })));
    expect((await call()).headers.get("location")).toBe("/pedido/descarga/ped.firma?error=upstream");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "no" }, { status: 404 })));
    expect((await call()).headers.get("location")).toBe("/pedido/descarga/ped.firma?error=invalid");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("caída")));
    expect((await call()).headers.get("location")).toBe("/pedido/descarga/ped.firma?error=upstream");
  });
});
