import { createHmac, timingSafeEqual } from "node:crypto";

// Enlace "gestiona tu reserva" (F5.4): `<id de la reserva>.<firma>`. La firma es un HMAC-SHA256 del
// id con un secreto de la instalación (`BOOKING_LINK_SECRET`), así que nadie puede fabricar el
// enlace de otra reserva, la base no guarda nada del enlace y el worker puede volver a armarlo para
// el recordatorio. Un propósito fijo en el mensaje firmado evita reutilizar la firma en otro lado.

const PURPOSE = "impulza:booking-manage:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function signature(bookingId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}${bookingId}`).digest("base64url");
}

export function signBookingLinkToken(bookingId: string, secret: string): string {
  return `${bookingId}.${signature(bookingId, secret)}`;
}

/** El id de la reserva si la firma es válida; `null` si no (comparación en tiempo constante). */
export function verifyBookingLinkToken(token: string, secret: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.length > 200) {
    return null;
  }
  const bookingId = token.slice(0, dot).toLowerCase();
  if (!UUID.test(bookingId)) {
    return null;
  }
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(bookingId, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? bookingId : null;
}
