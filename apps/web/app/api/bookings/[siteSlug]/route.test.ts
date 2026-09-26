import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { GET, POST } = await import("./route.js");
const { GET: GET_AVAILABILITY } = await import("./availability/route.js");
const params = { params: Promise.resolve({ siteSlug: "barberia-el-filo" }) };

describe("rutas de reservas del sitio público (F5.2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reenvía la reserva a la API con la cabecera anti-CSRF y devuelve su estado tal cual", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ message: "Esa hora ya no está disponible. Elige otra." }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      new Request("https://impulza.test/api/bookings/barberia-el-filo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Ana" }) }),
      params,
    );
    expect(response.status).toBe(409);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/public/sites/barberia-el-filo/booking");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("impulza-one");
  });

  it("si la API no responde, 502 con un mensaje para el visitante y sin registrar sus datos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST(
      new Request("https://impulza.test/api/bookings/barberia-el-filo", { method: "POST", body: JSON.stringify({ email: "ana@example.com" }) }),
      params,
    );
    expect(response.status).toBe(502);
    expect(JSON.stringify(log.mock.calls)).not.toContain("ana@example.com");
    expect((await GET(new Request("https://impulza.test/api/bookings/barberia-el-filo"), params)).status).toBe(502);
  });

  it("la disponibilidad solo reenvía los parámetros conocidos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ timeZone: "America/Santiago", days: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await GET_AVAILABILITY(new Request("https://impulza.test/api/bookings/x/availability?serviceId=s1&from=2030-01-07&days=7&otro=1"), params);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/api/v1/public/sites/barberia-el-filo/booking/availability?serviceId=s1&from=2030-01-07&days=7");
  });
});
