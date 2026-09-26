import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../lib/env.js", () => ({
  env: { API_BASE_URL: "http://api.test/api/v1", INTERNAL_PROXY_SECRET: "x".repeat(32) },
}));

const { POST } = await import("./route.js");

describe("POST /api/booking-manage/:token/:action (F5.4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("solo reenvía cancelar y cambiar hora; cualquier otra acción es 404 sin llamar a la API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(new Request("https://impulza.test/x", { method: "POST" }), { params: Promise.resolve({ token: "t", action: "delete" }) });
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reenvía a la API con la cabecera anti-CSRF y devuelve su estado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ message: "Ya no se puede cambiar" }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(
      new Request("https://impulza.test/x", { method: "POST", body: JSON.stringify({ startsAt: "2030-01-07T13:00:00Z" }) }),
      { params: Promise.resolve({ token: "abc.def", action: "reschedule" }) },
    );
    expect(response.status).toBe(409);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/public/bookings/abc.def/reschedule");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("impulza-one");
  });
});
