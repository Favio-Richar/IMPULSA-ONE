import { createHmac, timingSafeEqual } from "node:crypto";

// Enlace de descarga de un pedido (F5.11b, ADR-015): `<id del pedido>.<firma>`, HMAC-SHA256 con el
// secreto de enlaces firmados de correos (`BOOKING_LINK_SECRET`) y un propósito propio: una firma de
// reserva o de baja nunca sirve como descarga ni al revés. Se puede volver a armar en cada correo
// (a diferencia de un enlace aleatorio guardado como hash). Que el pedido esté pagado lo decide la
// API en cada uso: el enlace solo identifica el pedido.

const PURPOSE = "impulza:order-download:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function signature(orderId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}${orderId}`).digest("base64url");
}

export function signOrderDownloadToken(orderId: string, secret: string): string {
  return `${orderId}.${signature(orderId, secret)}`;
}

/** El id del pedido si la firma es válida; `null` si no (comparación en tiempo constante). */
export function verifyOrderDownloadToken(token: string, secret: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.length > 200) {
    return null;
  }
  const orderId = token.slice(0, dot).toLowerCase();
  if (!UUID.test(orderId)) {
    return null;
  }
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(orderId, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? orderId : null;
}
