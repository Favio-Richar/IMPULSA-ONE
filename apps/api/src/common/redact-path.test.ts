import { describe, expect, it } from "vitest";
import { redactPath } from "./redact-path.js";

describe("redactPath", () => {
  it("oculta el token del feed iCal, con o sin parámetros", () => {
    const token = "a".repeat(48);
    expect(redactPath(`/api/v1/public/bookings/calendar-feed/${token}.ics`)).toBe(
      "/api/v1/public/bookings/calendar-feed/[redactado].ics",
    );
    expect(redactPath(`/api/v1/public/bookings/calendar-feed/${token}.ics?x=1`)).toBe(
      "/api/v1/public/bookings/calendar-feed/[redactado].ics?x=1",
    );
  });

  it("oculta el token de confirmación de newsletter", () => {
    const token = "b".repeat(64);
    expect(redactPath(`/api/v1/public/newsletter/${token}`)).toBe(
      "/api/v1/public/newsletter/[redactado]",
    );
  });

  it("oculta el token de baja de correo (unsubscribe)", () => {
    const token = "c".repeat(64);
    expect(redactPath(`/api/v1/public/unsubscribe/${token}`)).toBe(
      "/api/v1/public/unsubscribe/[redactado]",
    );
  });

  it("oculta el token de gestión de reservas, con o sin subruta", () => {
    const token = "d".repeat(64);
    expect(redactPath(`/api/v1/public/bookings/${token}`)).toBe(
      "/api/v1/public/bookings/[redactado]",
    );
    expect(redactPath(`/api/v1/public/bookings/${token}/cancel`)).toBe(
      "/api/v1/public/bookings/[redactado]/cancel",
    );
    expect(redactPath(`/api/v1/public/bookings/${token}/reschedule`)).toBe(
      "/api/v1/public/bookings/[redactado]/reschedule",
    );
  });

  it("oculta el token de visualización de pedidos", () => {
    const token = "e".repeat(64);
    expect(redactPath(`/api/v1/public/orders/${token}`)).toBe(
      "/api/v1/public/orders/[redactado]",
    );
  });

  it("oculta el token de descargas digitales", () => {
    const token = "f".repeat(64);
    expect(redactPath(`/api/v1/public/downloads/${token}`)).toBe(
      "/api/v1/public/downloads/[redactado]",
    );
    expect(redactPath(`/api/v1/public/downloads/${token}/url`)).toBe(
      "/api/v1/public/downloads/[redactado]/url",
    );
  });

  it("oculta parámetros de consulta sensibles", () => {
    expect(redactPath("/api/v1/auth/callback?code=supersecret&state=signedstate")).toBe(
      "/api/v1/auth/callback?code=[redactado]&state=[redactado]",
    );
    expect(redactPath("/api/v1/endpoint?token=secrettoken&other=safe")).toBe(
      "/api/v1/endpoint?token=[redactado]&other=safe",
    );
  });

  it("deja intactas las demás rutas", () => {
    expect(redactPath("/api/v1/organizations/1/sites/2/booking/staff")).toBe(
      "/api/v1/organizations/1/sites/2/booking/staff",
    );
    expect(redactPath(undefined)).toBeUndefined();
  });
});
