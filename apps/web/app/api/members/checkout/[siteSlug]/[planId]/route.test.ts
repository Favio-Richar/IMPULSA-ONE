import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { POST } = await import("./route.js");
const PLAN = "11111111-1111-4111-8111-111111111111";
const params = { params: Promise.resolve({ siteSlug: "club-luna", planId: PLAN }) };

function buy(body: unknown): Request {
  return new Request("https://impulza.test/api/members/checkout/club-luna/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/members/checkout/:siteSlug/:planId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reenvía a la API del plan indicado y devuelve su respuesta tal cual", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ checkoutUrl: "https://mp.test/x", statusUrl: "https://s.test/y" }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(buy({ email: "socia@example.com" }), params);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ checkoutUrl: "https://mp.test/x", statusUrl: "https://s.test/y" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.test/api/v1/public/sites/club-luna/members/plans/${PLAN}/checkout`);
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("impulza-one");
  });

  it("un cuerpo que no es un objeto JSON se rechaza antes de llegar a la API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(buy("no es json"), params)).status).toBe(400);
    expect((await POST(buy([1]), params)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si la API no responde, 502 con un mensaje claro y sin registrar el correo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(buy({ email: "socia@example.com" }), params);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { message: string }).message).toMatch(/Intenta de nuevo/);
    expect(JSON.stringify(log.mock.calls)).not.toContain("socia@example.com");
  });
});
