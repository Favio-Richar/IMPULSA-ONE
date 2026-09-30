import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { MERCADO_PAGO_API } from "./mercado-pago.js";
import { PaymentGatewayError } from "./types.js";

// Conexión de la cuenta de Mercado Pago de un negocio (F5.8, ADR-013): OAuth 2.0 con PKCE (S256).
// El negocio autoriza en Mercado Pago y nos devuelve un código; lo cambiamos por un token con el
// que Impulza crea cobros **a nombre del negocio** — el dinero va directo a su cuenta.

export const MERCADO_PAGO_AUTH_URL = "https://auth.mercadopago.com/authorization";
const DEFAULT_TIMEOUT_MS = 20_000;

export interface MercadoPagoOAuthConfig {
  /** Id y secreto de la aplicación de Impulza en Mercado Pago (no del negocio). */
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Id de la cuenta de Mercado Pago del negocio. */
  providerUserId: string;
  expiresAt: Date;
  liveMode: boolean;
}

/** Verificador PKCE: 43–128 caracteres URL-safe (RFC 7636). */
export function createCodeVerifier(): string {
  return randomBytes(48).toString("base64url");
}

export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

const tokenResponse = z.object({
  access_token: z.string().min(10),
  refresh_token: z.string().min(10),
  user_id: z.union([z.number(), z.string()]).transform(String),
  expires_in: z.number().int().positive(),
  live_mode: z.boolean().optional(),
});

export class MercadoPagoOAuth {
  constructor(
    private readonly config: MercadoPagoOAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** URL a la que se lleva al dueño del negocio para que autorice. */
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL(MERCADO_PAGO_AUTH_URL);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("state", input.state);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }, now: Date = new Date()): Promise<OAuthTokens> {
    return this.token(
      { grant_type: "authorization_code", code: input.code, code_verifier: input.codeVerifier, redirect_uri: input.redirectUri },
      now,
    );
  }

  async refresh(refreshToken: string, now: Date = new Date()): Promise<OAuthTokens> {
    return this.token({ grant_type: "refresh_token", refresh_token: refreshToken }, now);
  }

  private async token(body: Record<string, string>, now: Date): Promise<OAuthTokens> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${MERCADO_PAGO_API}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...body }),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      if (controller.signal.aborted) throw new PaymentGatewayError("timeout", true, "Mercado Pago no respondió a tiempo.");
      throw new PaymentGatewayError("unavailable", true, `No se pudo conectar con Mercado Pago: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      // Código vencido o ya usado, verificador que no calza, o token de renovación revocado.
      throw new PaymentGatewayError("rejected", false, "Mercado Pago rechazó la autorización.");
    }
    if (!response.ok) throw new PaymentGatewayError("unavailable", true, `Mercado Pago respondió ${response.status}.`);
    const parsed = tokenResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new PaymentGatewayError("invalid_response", false, "La respuesta de Mercado Pago no tiene la forma esperada.");
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      providerUserId: parsed.data.user_id,
      expiresAt: new Date(now.getTime() + parsed.data.expires_in * 1000),
      liveMode: parsed.data.live_mode ?? true,
    };
  }
}

export type MercadoPagoOAuthLike = Pick<MercadoPagoOAuth, "authorizationUrl" | "exchangeCode" | "refresh">;

/** OAuth simulado para pruebas: acepta el código `ok-*`, rechaza el resto. */
export class FakeMercadoPagoOAuth implements MercadoPagoOAuthLike {
  readonly exchanges: Array<{ code: string; codeVerifier: string; redirectUri: string }> = [];
  failRefresh = false;
  private seq = 0;

  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL(MERCADO_PAGO_AUTH_URL);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("redirect_uri", input.redirectUri);
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }, now: Date = new Date()): Promise<OAuthTokens> {
    this.exchanges.push(input);
    if (!input.code.startsWith("ok-")) throw new PaymentGatewayError("rejected", false, "Código inválido.");
    return this.issue(now);
  }

  async refresh(_refreshToken: string, now: Date = new Date()): Promise<OAuthTokens> {
    if (this.failRefresh) throw new PaymentGatewayError("rejected", false, "Renovación revocada.");
    return this.issue(now);
  }

  private issue(now: Date): OAuthTokens {
    this.seq += 1;
    const stamp = `${Date.now()}${this.seq}`;
    return {
      accessToken: `APP_USR-access-${stamp}`,
      refreshToken: `TG-refresh-${stamp}`,
      providerUserId: `77${stamp}`,
      expiresAt: new Date(now.getTime() + 180 * 24 * 3_600_000),
      liveMode: false,
    };
  }
}
