import { describe, expect, it } from "vitest";
import { codeChallengeFor, createCodeVerifier, MercadoPagoOAuth, mercadoPagoOAuthConfigFromEnv } from "./index.js";

describe("PKCE", () => {
  it("el desafío S256 coincide con el vector de prueba de la RFC 7636 (apéndice B)", () => {
    expect(codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("el verificador es URL-safe, de largo válido y distinto cada vez", () => {
    const a = createCodeVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(createCodeVerifier()).not.toBe(a);
  });
});

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("MercadoPagoOAuth", () => {
  const config = { clientId: "1234567890", clientSecret: "secreto-de-la-aplicacion-0000" };

  it("arma la URL de autorización con PKCE S256 y el state", () => {
    const url = new URL(new MercadoPagoOAuth(config).authorizationUrl({ state: "st-1", codeChallenge: "ch-1", redirectUri: "https://api.impulza.test/cb" }));
    expect(url.origin + url.pathname).toBe("https://auth.mercadopago.com/authorization");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "1234567890",
      response_type: "code",
      platform_id: "mp",
      state: "st-1",
      redirect_uri: "https://api.impulza.test/cb",
      code_challenge: "ch-1",
      code_challenge_method: "S256",
    });
  });

  it("cambia el código por tokens con el verificador, y calcula el vencimiento", async () => {
    const { impl, calls } = fakeFetch(200, { access_token: "APP_USR-abc123456789", refresh_token: "TG-refresh-123456789", user_id: 998877, expires_in: 15_552_000, live_mode: true });
    const now = new Date("2026-09-30T12:00:00Z");
    const tokens = await new MercadoPagoOAuth(config, impl).exchangeCode({ code: "TG-code", codeVerifier: "ver", redirectUri: "https://api.impulza.test/cb" }, now);
    expect(tokens).toMatchObject({ accessToken: "APP_USR-abc123456789", providerUserId: "998877", liveMode: true });
    expect(tokens.expiresAt.toISOString()).toBe("2027-03-29T12:00:00.000Z");
    expect(calls[0]!.url).toBe("https://api.mercadopago.com/oauth/token");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      client_id: "1234567890",
      client_secret: "secreto-de-la-aplicacion-0000",
      grant_type: "authorization_code",
      code: "TG-code",
      code_verifier: "ver",
      redirect_uri: "https://api.impulza.test/cb",
    });
  });

  it("un código vencido o un verificador que no calza se informa como rechazo", async () => {
    const { impl } = fakeFetch(400, { error: "invalid_grant" });
    await expect(new MercadoPagoOAuth(config, impl).exchangeCode({ code: "x", codeVerifier: "y", redirectUri: "z" })).rejects.toMatchObject({ code: "rejected" });
  });

  it("renueva con el token de renovación", async () => {
    const { impl, calls } = fakeFetch(200, { access_token: "APP_USR-nuevo-123456789", refresh_token: "TG-nuevo-123456789", user_id: "998877", expires_in: 100 });
    await new MercadoPagoOAuth(config, impl).refresh("TG-viejo");
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ grant_type: "refresh_token", refresh_token: "TG-viejo" });
  });

  it("configuración: las tres variables o ninguna", () => {
    expect(mercadoPagoOAuthConfigFromEnv({})).toBeNull();
    expect(() => mercadoPagoOAuthConfigFromEnv({ MERCADOPAGO_CLIENT_ID: "1234567890" })).toThrow(/incompleta/);
    expect(() => mercadoPagoOAuthConfigFromEnv({ MERCADOPAGO_CLIENT_ID: "1234567890", MERCADOPAGO_CLIENT_SECRET: "secreto-de-la-aplicacion-0000" })).toThrow(/incompleta/);
    expect(
      mercadoPagoOAuthConfigFromEnv({ MERCADOPAGO_CLIENT_ID: "1234567890", MERCADOPAGO_CLIENT_SECRET: "secreto-de-la-aplicacion-0000", MERCADOPAGO_APP_WEBHOOK_SECRET: "clave-de-firma-de-avisos-0000" }),
    ).toMatchObject({ webhookSecret: "clave-de-firma-de-avisos-0000" });
  });
});
