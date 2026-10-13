import { createHmac, timingSafeEqual } from "node:crypto";

// Enlace "gestiona tu reserva" (F5.4): `<id de la reserva>.<emision>.<firma>`. La firma es un
// HMAC-SHA256 del id y la fecha de emisión con un secreto de la instalación
// (`BOOKING_LINK_SECRET`), así que nadie puede fabricar el enlace de otra reserva ni cambiarle la
// fecha de emisión, la base no guarda nada del enlace y el worker puede volver a armarlo para el
// recordatorio. Un propósito fijo en el mensaje firmado evita reutilizar la firma en otro lado.
//
// Vencimiento (decisión del propietario, 2026-10-13): el enlace deja de servir pasados
// `MAX_AGE_SECONDS` desde que se firmó, aunque la firma siga siendo matemáticamente válida -- así
// un enlace filtrado o reenviado no sirve para siempre. 90 días cubre reservas hechas con
// anticipación y su gestión posterior (reagendar, cancelar) sin obligar a pedir uno nuevo seguido.

const PURPOSE = "impulza:booking-manage:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

function signature(bookingId: string, issuedAt: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}${bookingId}.${issuedAt}`).digest("base64url");
}

export function signBookingLinkToken(bookingId: string, secret: string, now: Date = new Date()): string {
  const issuedAt = Math.floor(now.getTime() / 1000).toString(36);
  return `${bookingId}.${issuedAt}.${signature(bookingId, issuedAt, secret)}`;
}

/** El id de la reserva si la firma es válida y no venció; `null` si no (comparación en tiempo constante). */
export function verifyBookingLinkToken(token: string, secret: string, now: Date = new Date()): string | null {
  if (token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [bookingId, issuedAt, givenSignature] = parts as [string, string, string];
  if (!UUID.test(bookingId.toLowerCase()) || !/^[0-9a-z]+$/.test(issuedAt)) return null;

  const given = Buffer.from(givenSignature);
  const expected = Buffer.from(signature(bookingId.toLowerCase(), issuedAt, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const issuedAtSeconds = parseInt(issuedAt, 36);
  const ageSeconds = Math.floor(now.getTime() / 1000) - issuedAtSeconds;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > MAX_AGE_SECONDS) return null;

  return bookingId.toLowerCase();
}
