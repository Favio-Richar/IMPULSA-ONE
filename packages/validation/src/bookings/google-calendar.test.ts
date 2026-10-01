import { describe, expect, it } from "vitest";
import {
  connectGoogleCalendarSchema,
  disconnectGoogleCalendarSchema,
  googleCalendarAuthUrlQuerySchema,
} from "./google-calendar.js";

describe("Google Calendar schemas (F7.9c)", () => {
  it("valida query para URL de autorización", () => {
    const valid = googleCalendarAuthUrlQuerySchema.safeParse({
      redirectUri: "https://dashboard.impulza.cl/api/auth/callback",
    });
    expect(valid.success).toBe(true);

    const validWithStaff = googleCalendarAuthUrlQuerySchema.safeParse({
      redirectUri: "https://dashboard.impulza.cl/api/auth/callback",
      staffId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    });
    expect(validWithStaff.success).toBe(true);

    const invalidUri = googleCalendarAuthUrlQuerySchema.safeParse({
      redirectUri: "not-a-url",
    });
    expect(invalidUri.success).toBe(false);

    const invalidStaff = googleCalendarAuthUrlQuerySchema.safeParse({
      redirectUri: "https://dashboard.impulza.cl/api/auth/callback",
      staffId: "invalid-uuid",
    });
    expect(invalidStaff.success).toBe(false);
  });

  it("valida input para conectar Google Calendar", () => {
    const valid = connectGoogleCalendarSchema.safeParse({
      code: "auth-code-123",
      state: "cuerpo.firma",
      redirectUri: "https://dashboard.impulza.cl/api/auth/callback",
    });
    expect(valid.success).toBe(true);

    const emptyCode = connectGoogleCalendarSchema.safeParse({
      code: "",
      state: "cuerpo.firma",
      redirectUri: "https://dashboard.impulza.cl/api/auth/callback",
    });
    expect(emptyCode.success).toBe(false);

    // Sin `state` no hay conexión: es lo que ata la autorización a quien la inició.
    const noState = connectGoogleCalendarSchema.safeParse({
      code: "auth-code-123",
      redirectUri: "https://dashboard.impulza.cl/api/auth/callback",
    });
    expect(noState.success).toBe(false);
  });

  it("valida input para desconectar Google Calendar", () => {
    const siteDisconnect = disconnectGoogleCalendarSchema.safeParse({});
    expect(siteDisconnect.success).toBe(true);

    const staffDisconnect = disconnectGoogleCalendarSchema.safeParse({
      staffId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    });
    expect(staffDisconnect.success).toBe(true);
  });
});
