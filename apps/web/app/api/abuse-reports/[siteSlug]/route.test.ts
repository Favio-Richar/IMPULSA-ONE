import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { POST } = await import("./route.js");
const params = { params: Promise.resolve({ siteSlug: "ana-rojas" }) };

function report(body: unknown): Request {
  return new Request("https://impulza.test/api/abuse-reports/ana-rojas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/abuse-reports/:siteSlug", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reenvía el cuerpo y la respuesta de la API sin modificarlos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ received: true }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(report({ reason: "SPAM" }), params);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ received: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/public/sites/ana-rojas/abuse-reports");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("impulza-one");
  });

  it("un cuerpo que no es un objeto JSON se rechaza antes de llegar a la API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(report("no es json"), params)).status).toBe(400);
    expect((await POST(report([1, 2]), params)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si la API no responde, 502 con un mensaje para el visitante y sin registrar lo que escribió", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(report({ reason: "SPAM", details: "texto privado", email: "ana@example.com" }), params);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { message: string }).message).toMatch(/Intenta de nuevo/);
    expect(JSON.stringify(log.mock.calls)).not.toContain("ana@example.com");
    expect(JSON.stringify(log.mock.calls)).not.toContain("texto privado");
  });
});
