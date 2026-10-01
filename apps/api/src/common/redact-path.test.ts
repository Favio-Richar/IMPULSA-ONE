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

  it("deja intactas las demás rutas", () => {
    expect(redactPath("/api/v1/organizations/1/sites/2/booking/staff")).toBe(
      "/api/v1/organizations/1/sites/2/booking/staff",
    );
    expect(redactPath(undefined)).toBeUndefined();
  });
});
