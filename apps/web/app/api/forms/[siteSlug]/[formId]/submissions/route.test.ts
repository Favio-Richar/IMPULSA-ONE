import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { POST } = await import("./route.js");
const params = { params: Promise.resolve({ siteSlug: "ana-rojas", formId: "11111111-1111-4111-8111-111111111111" }) };

function submission(): Request {
  return new Request("https://impulza.test/api/forms/ana-rojas/x/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: "Ana", correo: "ana@example.com" }),
  });
}

describe("POST /api/forms/:siteSlug/:formId/submissions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("si la API no responde, 502 con un mensaje para el visitante y sin registrar sus datos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(submission(), params);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { message: string }).message).toMatch(/Intenta de nuevo/);
    expect(JSON.stringify(log.mock.calls)).not.toContain("ana@example.com");
  });
});
