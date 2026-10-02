import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const info = vi.fn();
vi.mock("../observability/logger.js", () => ({ logger: { info, warn: vi.fn(), error: vi.fn() } }));

const { requestContextMiddleware } = await import("./request-context.middleware.js");
const { AllExceptionsFilter } = await import("./all-exceptions.filter.js");

// `redactPath` solo protege si el log de cada petición y el filtro de excepciones lo usan de verdad.

const TOKEN = "a".repeat(48);

describe("el log de cada petición no escribe secretos de la URL", () => {
  it("requestContextMiddleware registra la ruta con el token del feed oculto", () => {
    const response = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn() });
    const request = {
      method: "GET",
      originalUrl: `/api/v1/public/bookings/calendar-feed/${TOKEN}.ics`,
      get: () => undefined,
    };
    requestContextMiddleware(request as never, response as never, () => undefined);
    response.emit("finish");

    expect(info).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(info.mock.calls[0]);
    expect(logged).not.toContain(TOKEN);
    expect(logged).toContain("[redactado]");
  });

  it("AllExceptionsFilter no manda el token a los logs ni a Sentry en un 500", async () => {
    const { logger } = await import("../observability/logger.js");
    const observability = await import("@impulza/observability");
    const capture = vi.spyOn(observability, "captureException").mockImplementation(() => undefined as never);
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: "GET", originalUrl: `/api/v1/public/unsubscribe/${TOKEN}` }),
        getResponse: () => ({ headersSent: true, status: vi.fn().mockReturnThis(), json: vi.fn() }),
      }),
      getType: () => "http",
    };
    try {
      new AllExceptionsFilter().catch(new Error("boom"), host as never);
    } catch {
      // `super.catch` necesita un adaptador HTTP real; lo que interesa ocurre antes.
    }
    const seen = JSON.stringify([(logger.error as ReturnType<typeof vi.fn>).mock.calls, capture.mock.calls]);
    expect(seen).not.toContain(TOKEN);
    expect(seen).toContain("[redactado]");
  });
});
