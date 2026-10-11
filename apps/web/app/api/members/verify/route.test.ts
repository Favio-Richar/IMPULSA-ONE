import { afterEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set, get: vi.fn(), delete: vi.fn() }) }));
vi.mock("../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { POST } = await import("./route.js");

const TOKEN = "A".repeat(43);
function verify(body: unknown): Request {
  return new Request("https://impulza.test/api/members/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/members/verify", () => {
  afterEach(() => {
    set.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("guarda la sesión en una cookie HttpOnly del sitio y no la devuelve en el cuerpo", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ siteSlug: "mi-sitio", sessionToken: "S".repeat(43), expiresAt }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    const response = await POST(verify({ token: TOKEN }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ siteSlug: "mi-sitio" });
    expect(JSON.stringify(body)).not.toContain("S".repeat(43));

    expect(set).toHaveBeenCalledTimes(1);
    const [name, value, options] = set.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("impulza_member_mi-sitio");
    expect(value).toBe("S".repeat(43));
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(options.expires).toEqual(new Date(expiresAt));
  });

  it("un enlace inválido responde 401 con un mensaje único y no deja ninguna cookie", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Este enlace no es válido o ya venció." }), { status: 401 })));
    const response = await POST(verify({ token: TOKEN }));
    expect(response.status).toBe(401);
    expect(set).not.toHaveBeenCalled();
  });

  it("un cuerpo que no es un objeto se rechaza antes de llegar a la API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(verify("no es json"))).status).toBe(400);
    expect((await POST(verify([1]))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("si la API no responde, 502 y sin cookie", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(verify({ token: TOKEN }));
    expect(response.status).toBe(502);
    expect(set).not.toHaveBeenCalled();
  });
});
