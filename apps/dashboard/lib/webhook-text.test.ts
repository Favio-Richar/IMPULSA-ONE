import { describe, expect, it } from "vitest";
import { deliveryErrorText, displayUrl, endpointHealth, eventLabel } from "./webhook-text";

describe("textos de Integraciones (F7.2)", () => {
  it("nombra los eventos, la prueba y los desconocidos sin romper", () => {
    expect(eventLabel("order.paid")).toBe("Pedido pagado");
    expect(eventLabel("ping")).toBe("Prueba");
    expect(eventLabel("algo.nuevo")).toBe("algo.nuevo");
  });

  it("explica cada falla en una frase, sin esconder el código", () => {
    expect(deliveryErrorText({ lastError: null, lastStatusCode: 200 })).toBeNull();
    expect(deliveryErrorText({ lastError: "http_500", lastStatusCode: 500 })).toContain("(500)");
    expect(deliveryErrorText({ lastError: "http_410", lastStatusCode: 410 })).toContain("ya no existe");
    expect(deliveryErrorText({ lastError: "http_401", lastStatusCode: 401 })).toContain("autenticación");
    expect(deliveryErrorText({ lastError: "timeout", lastStatusCode: null })).toContain("10 segundos");
    expect(deliveryErrorText({ lastError: "unsafe_destination", lastStatusCode: null })).toContain("red privada");
    expect(deliveryErrorText({ lastError: "redirect_not_followed", lastStatusCode: 302 })).toContain("redirección");
    expect(deliveryErrorText({ lastError: "EPIPE", lastStatusCode: null })).toBe("Error de conexión (EPIPE).");
  });

  it("el estado del destino distingue pausado, desactivado por el sistema y con fallas", () => {
    expect(endpointHealth({ active: true, disabledReason: null, consecutiveFailures: 0 })).toMatchObject({ tone: "success", label: "Activo" });
    expect(endpointHealth({ active: true, disabledReason: null, consecutiveFailures: 3 })).toMatchObject({ tone: "warning", detail: expect.stringContaining("3 entregas") });
    expect(endpointHealth({ active: false, disabledReason: null, consecutiveFailures: 0 })).toMatchObject({ tone: "muted", label: "Pausado" });
    expect(endpointHealth({ active: false, disabledReason: "gone", consecutiveFailures: 0 }).detail).toContain("410");
    expect(endpointHealth({ active: false, disabledReason: "too_many_failures", consecutiveFailures: 15 }).detail).toContain("15");
  });

  it("recorta la ruta larga al medio y conserva el host", () => {
    const long = displayUrl("https://hooks.zapier.com/hooks/catch/123456/abcdefghijklmnopqrstuvwxyz0123456789/", 24);
    expect(long.host).toBe("hooks.zapier.com");
    expect(long.path.length).toBeLessThanOrEqual(24);
    expect(long.path).toContain("…");
    expect(displayUrl("https://hook.eu1.make.com/")).toEqual({ host: "hook.eu1.make.com", path: "" });
  });
});
