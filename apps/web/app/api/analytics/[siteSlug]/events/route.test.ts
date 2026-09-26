import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { POST } = await import("./route.js");
const params = { params: Promise.resolve({ siteSlug: "ana-rojas" }) };

function event(): Request {
  return new Request("https://impulza.test/api/analytics/ana-rojas/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (iPhone)" },
    body: JSON.stringify({ type: "page_view", pageSlug: "inicio" }),
  });
}

describe("POST /api/analytics/:siteSlug/events", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reenvía a la API y devuelve su estado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
    const response = await POST(event(), params);
    expect(response.status).toBe(202);
  });

  it("si la API no responde, contesta 502 sin lanzar un error sin manejar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(event(), params);
    expect(response.status).toBe(502);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"route":"analytics"'));
  });
});
