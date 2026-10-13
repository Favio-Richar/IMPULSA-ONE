import { createHmac, timingSafeEqual } from "node:crypto";

// Enlace de descarga de un pedido (F5.11b, ADR-015): `<id del pedido>.<emision>.<firma>`,
// HMAC-SHA256 con el secreto de enlaces firmados de correos (`BOOKING_LINK_SECRET`) y un propósito
// propio: una firma de reserva o de baja nunca sirve como descarga ni al revés. Se puede volver a
// armar en cada correo (a diferencia de un enlace aleatorio guardado como hash). Que el pedido
// esté pagado lo decide la API en cada uso: el enlace solo identifica el pedido.
//
// Vencimiento (decisión del propietario, 2026-10-13): 180 días desde que se firmó -- tiempo
// generoso para volver a descargar un producto digital ya comprado, sin dejar el enlace vigente
// para siempre si se filtra o se reenvía.

const PURPOSE = "impulza:order-download:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function signature(orderId: string, issuedAt: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}${orderId}.${issuedAt}`).digest("base64url");
}

export function signOrderDownloadToken(orderId: string, secret: string, now: Date = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000).toString(36);
  return `${orderId}.${issuedAt}.${signature(orderId, issuedAt, secret)}`;
}

/** El id del pedido si la firma es válida y no venció; `null` si no (comparación en tiempo constante). */
export function verifyOrderDownloadToken(token: string, secret: string, now: Date = new Date()): string | null {
  if (token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [orderId, issuedAt, givenSignature] = parts as [string, string, string];
  if (!UUID.test(orderId.toLowerCase()) || !/^[0-9a-z]+$/.test(issuedAt)) return null;

  const given = Buffer.from(givenSignature);
  const expected = Buffer.from(signature(orderId.toLowerCase(), issuedAt, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const issuedAtSeconds = parseInt(issuedAt, 36);
  const ageSeconds = Math.floor(now.getTime() / 1000) - issuedAtSeconds;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > MAX_AGE_SECONDS) return null;

  return orderId.toLowerCase();
}
