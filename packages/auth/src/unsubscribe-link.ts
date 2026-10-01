import { createHmac, timingSafeEqual } from "node:crypto";

// Enlaces de baja (F5.6 campañas, F7.5 secuencias): `<id>.<firma>`, HMAC-SHA256 con el mismo secreto
// de enlaces firmados de correos que "gestiona tu reserva" (`BOOKING_LINK_SECRET`), pero con un
// **propósito distinto** en el mensaje firmado: una firma de reserva nunca sirve como baja, y una baja
// de campaña nunca vale como la de una secuencia (cada una apunta a otra tabla).

const CAMPAIGN_PURPOSE = "impulza:campaign-unsubscribe:v1:";
const SEQUENCE_PURPOSE = "impulza:sequence-unsubscribe:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function signature(purpose: string, id: string, secret: string): string {
  return createHmac("sha256", secret).update(`${purpose}${id}`).digest("base64url");
}

function sign(purpose: string, id: string, secret: string): string {
  return `${id}.${signature(purpose, id, secret)}`;
}

/** El id si la firma es válida para ese propósito; `null` si no (comparación en tiempo constante). */
function verify(purpose: string, token: string, secret: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.length > 200) {
    return null;
  }
  const id = token.slice(0, dot).toLowerCase();
  if (!UUID.test(id)) {
    return null;
  }
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(purpose, id, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

/** Baja desde una campaña: firma el id del destinatario (`campaign_recipients`). */
export function signUnsubscribeToken(recipientId: string, secret: string): string {
  return sign(CAMPAIGN_PURPOSE, recipientId, secret);
}

export function verifyUnsubscribeToken(token: string, secret: string): string | null {
  return verify(CAMPAIGN_PURPOSE, token, secret);
}

/** Baja desde una secuencia (F7.5): firma el id de la inscripción (`email_sequence_enrollments`). */
export function signSequenceUnsubscribeToken(enrollmentId: string, secret: string): string {
  return sign(SEQUENCE_PURPOSE, enrollmentId, secret);
}

export function verifySequenceUnsubscribeToken(token: string, secret: string): string | null {
  return verify(SEQUENCE_PURPOSE, token, secret);
}
