import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Vigencia del `state`: el tiempo razonable para autorizar en Google y volver al panel. */
export const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleOAuthStatePayload {
  userId: string;
  organizationId: string;
  siteId: string;
  staffId: string | null;
  redirectUri: string;
  nonce: string;
  expiresAt: number;
}

function sign(body: string, key: string): string {
  // La clave de firma se deriva de la de cifrado con una etiqueta propia: no se reutiliza el mismo uso.
  const derived = createHmac("sha256", Buffer.from(key, "base64")).update("google-oauth-state:v1").digest();
  return createHmac("sha256", derived).update(body).digest("base64url");
}

/** Crea un `state` firmado (HMAC-SHA256) que ata la autorización a quien la inició, su sitio y su `redirectUri`. */
export function createGoogleOAuthState(
  input: Omit<GoogleOAuthStatePayload, "nonce" | "expiresAt">,
  key: string,
  now: number = Date.now(),
): string {
  const payload: GoogleOAuthStatePayload = {
    ...input,
    nonce: randomBytes(16).toString("hex"),
    expiresAt: now + GOOGLE_OAUTH_STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, key)}`;
}

/** Devuelve el contenido del `state` si la firma es válida y no venció; `null` en cualquier otro caso. */
export function verifyGoogleOAuthState(
  state: string,
  key: string,
  now: number = Date.now(),
): GoogleOAuthStatePayload | null {
  const [body, signature, ...rest] = state.split(".");
  if (!body || !signature || rest.length > 0) {
    return null;
  }
  const expected = Buffer.from(sign(body, key));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GoogleOAuthStatePayload;
    if (typeof payload.expiresAt !== "number" || payload.expiresAt < now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
