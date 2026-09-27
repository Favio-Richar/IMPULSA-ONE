import { createHmac, timingSafeEqual } from "node:crypto";

// Enlace de baja de campañas (F5.6): `<id del destinatario>.<firma>`, HMAC-SHA256 con el mismo
// secreto de enlaces firmados de correos que "gestiona tu reserva" (`BOOKING_LINK_SECRET`), pero
// con otro propósito en el mensaje firmado: una firma de reserva nunca sirve como baja ni al revés.

const PURPOSE = "impulza:campaign-unsubscribe:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function signature(recipientId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${PURPOSE}${recipientId}`).digest("base64url");
}

export function signUnsubscribeToken(recipientId: string, secret: string): string {
  return `${recipientId}.${signature(recipientId, secret)}`;
}

/** El id del destinatario si la firma es válida; `null` si no (comparación en tiempo constante). */
export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.length > 200) {
    return null;
  }
  const recipientId = token.slice(0, dot).toLowerCase();
  if (!UUID.test(recipientId)) {
    return null;
  }
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(recipientId, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? recipientId : null;
}
