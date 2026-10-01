import { describe, expect, it } from "vitest";
import { GOOGLE_OAUTH_STATE_TTL_MS, createGoogleOAuthState, verifyGoogleOAuthState } from "./google-oauth-state.js";

const KEY = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";
const INPUT = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  siteId: "33333333-3333-4333-8333-333333333333",
  staffId: null,
  redirectUri: "http://localhost:3100/sitios/x/reservas",
};

describe("state firmado del OAuth de Google Calendar", () => {
  it("se verifica y devuelve a quién y a qué sitio ata la autorización", () => {
    const state = createGoogleOAuthState(INPUT, KEY);
    const payload = verifyGoogleOAuthState(state, KEY);
    expect(payload).toMatchObject(INPUT);
  });

  it("rechaza un state alterado, con otra clave, mal formado o vencido", () => {
    const now = Date.now();
    const state = createGoogleOAuthState(INPUT, KEY, now);
    const [body, signature] = state.split(".") as [string, string];

    // Cambiar el sitio dentro del cuerpo, conservando la firma original.
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString("utf8")), siteId: "otro" }),
    ).toString("base64url");
    expect(verifyGoogleOAuthState(`${forged}.${signature}`, KEY, now)).toBeNull();

    expect(verifyGoogleOAuthState(state, "b3RyYS1jbGF2ZS1kistinta-0123456789abcdefghij=", now)).toBeNull();
    expect(verifyGoogleOAuthState("basura", KEY, now)).toBeNull();
    expect(verifyGoogleOAuthState(`${body}.${signature}.extra`, KEY, now)).toBeNull();
    expect(verifyGoogleOAuthState(state, KEY, now + GOOGLE_OAUTH_STATE_TTL_MS + 1)).toBeNull();
  });

  it("cada state lleva un nonce distinto", () => {
    expect(createGoogleOAuthState(INPUT, KEY)).not.toBe(createGoogleOAuthState(INPUT, KEY));
  });
});
