import { createHmac, timingSafeEqual } from "node:crypto";

// Enlaces de baja (F5.6 campañas, F7.5 secuencias): `<id>.<emision>.<firma>`, HMAC-SHA256 con el
// mismo secreto de enlaces firmados de correos que "gestiona tu reserva" (`BOOKING_LINK_SECRET`),
// pero con un **propósito distinto** en el mensaje firmado: una firma de reserva nunca sirve como
// baja, y una baja de campaña nunca vale como la de una secuencia (cada una apunta a otra tabla).
//
// Vencimiento (decisión del propietario, 2026-10-13): 730 días desde que se firmó -- deliberadamente
// largo. Un enlace de baja que deja de funcionar es un riesgo real de cumplimiento (la persona ya
// no puede darse de baja de algo que le sigue llegando), así que el vencimiento acá es solo una
// cota de seguridad ante un enlace muy viejo, no una ventana corta como en reservas o descargas.

const CAMPAIGN_PURPOSE = "impulza:campaign-unsubscribe:v1:";
const SEQUENCE_PURPOSE = "impulza:sequence-unsubscribe:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_AGE_SECONDS = 730 * 24 * 60 * 60;

function signature(purpose: string, id: string, issuedAt: string, secret: string): string {
  return createHmac("sha256", secret).update(`${purpose}${id}.${issuedAt}`).digest("base64url");
}

function sign(purpose: string, id: string, secret: string, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000).toString(36);
  return `${id}.${issuedAt}.${signature(purpose, id, issuedAt, secret)}`;
}

/** El id si la firma es válida para ese propósito y no venció; `null` si no (comparación en tiempo constante). */
function verify(purpose: string, token: string, secret: string, now: Date): string | null {
  if (token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, issuedAt, givenSignature] = parts as [string, string, string];
  if (!UUID.test(id.toLowerCase()) || !/^[0-9a-z]+$/.test(issuedAt)) return null;

  const given = Buffer.from(givenSignature);
  const expected = Buffer.from(signature(purpose, id.toLowerCase(), issuedAt, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const issuedAtSeconds = parseInt(issuedAt, 36);
  const ageSeconds = Math.floor(now.getTime() / 1000) - issuedAtSeconds;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > MAX_AGE_SECONDS) return null;

  return id.toLowerCase();
}

/** Baja desde una campaña: firma el id del destinatario (`campaign_recipients`). */
export function signUnsubscribeToken(recipientId: string, secret: string, now: Date = new Date()): string {
  return sign(CAMPAIGN_PURPOSE, recipientId, secret, now);
}

export function verifyUnsubscribeToken(token: string, secret: string, now: Date = new Date()): string | null {
  return verify(CAMPAIGN_PURPOSE, token, secret, now);
}

/** Baja desde una secuencia (F7.5): firma el id de la inscripción (`email_sequence_enrollments`). */
export function signSequenceUnsubscribeToken(enrollmentId: string, secret: string, now: Date = new Date()): string {
  return sign(SEQUENCE_PURPOSE, enrollmentId, secret, now);
}

export function verifySequenceUnsubscribeToken(token: string, secret: string, now: Date = new Date()): string | null {
  return verify(SEQUENCE_PURPOSE, token, secret, now);
}
