import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Firma de los webhooks salientes (ADR-017 §2): `Impulza-Signature: t=<unix>,v1=<hex>`, con
// HMAC-SHA256 del secreto sobre `<t>.<cuerpo>`. La marca de tiempo va firmada: un aviso capturado no
// se puede reenviar más tarde si el receptor aplica la tolerancia.

export const SIGNATURE_HEADER = "Impulza-Signature";
export const SECRET_PREFIX = "whsec_";
/** Tolerancia recomendada al receptor entre la marca de tiempo y su reloj. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Secreto nuevo: 32 bytes aleatorios. Se muestra una sola vez; se guarda cifrado. */
export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

function hmac(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Valor de la cabecera de firma para `body`, con la marca de tiempo `timestamp` (segundos). */
export function signWebhook(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, body)}`;
}

/**
 * Lo que tiene que hacer el receptor (el panel muestra este mismo algoritmo): comparar en tiempo
 * constante y rechazar marcas de tiempo fuera de la tolerancia. Acepta varias firmas `v1` (útil al
 * rotar el secreto).
 */
export function verifyWebhookSignature(input: { header: string | null | undefined; body: string; secret: string; nowSeconds: number; toleranceSeconds?: number }): boolean {
  if (!input.header) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of input.header.split(",")) {
    const [key, value] = part.split("=", 2).map((piece) => piece?.trim());
    if (key === "t" && value && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    if (key === "v1" && value && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(input.nowSeconds - timestamp) > (input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS)) return false;
  const expected = Buffer.from(hmac(input.secret, timestamp, input.body), "hex");
  return signatures.some((candidate) => {
    const given = Buffer.from(candidate, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
