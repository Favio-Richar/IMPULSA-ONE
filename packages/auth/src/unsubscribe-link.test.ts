import { describe, expect, it } from "vitest";
import { signBookingLinkToken, verifyBookingLinkToken } from "./booking-link.js";
import { signSequenceUnsubscribeToken, signUnsubscribeToken, verifySequenceUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-link.js";

const SECRET = "s".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const DAY = 24 * 60 * 60 * 1000;

describe("enlace de baja de campañas (F5.6/F5.7)", () => {
  it("un enlace firmado se verifica y devuelve el id del destinatario", () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(ID, SECRET), SECRET)).toBe(ID);
  });

  it("no se puede fabricar: otra firma, otro id, otro secreto o basura dan null", () => {
    const token = signUnsubscribeToken(ID, SECRET);
    const otherId = "22222222-2222-4222-8222-222222222222";
    const [, issuedAt, signature] = token.split(".");
    expect(verifyUnsubscribeToken(`${otherId}.${issuedAt}.${signature}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${ID}.${issuedAt}.${signature!.slice(0, -1)}A`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${token}a`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(token, "x".repeat(32))).toBeNull();
    for (const junk of ["", ".", ID, `${ID}.`, "no-es-uuid.abc.def", `${"a".repeat(300)}.b.c`]) {
      expect(verifyUnsubscribeToken(junk, SECRET), junk).toBeNull();
    }
  });

  it("comparte secreto con la gestión de reservas pero no la firma: ninguna sirve por la otra", () => {
    expect(verifyUnsubscribeToken(signBookingLinkToken(ID, SECRET), SECRET)).toBeNull();
    expect(verifyBookingLinkToken(signUnsubscribeToken(ID, SECRET), SECRET)).toBeNull();
  });

  it("vence a los 730 días: justo antes sigue valiendo, justo después ya no (decisión del propietario, 2026-10-13)", () => {
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const token = signUnsubscribeToken(ID, SECRET, issuedAt);

    const justBefore = new Date(issuedAt.getTime() + 730 * DAY - 1000);
    expect(verifyUnsubscribeToken(token, SECRET, justBefore)).toBe(ID);

    const justAfter = new Date(issuedAt.getTime() + 730 * DAY + 1000);
    expect(verifyUnsubscribeToken(token, SECRET, justAfter)).toBeNull();
  });
});

describe("enlace de baja de secuencias (F7.5, ADR-020)", () => {
  it("se verifica con su propio propósito y no vale como baja de campaña ni al revés", () => {
    const sequence = signSequenceUnsubscribeToken(ID, SECRET);
    expect(verifySequenceUnsubscribeToken(sequence, SECRET)).toBe(ID);
    expect(verifyUnsubscribeToken(sequence, SECRET)).toBeNull();
    expect(verifySequenceUnsubscribeToken(signUnsubscribeToken(ID, SECRET), SECRET)).toBeNull();
    expect(verifySequenceUnsubscribeToken(signBookingLinkToken(ID, SECRET), SECRET)).toBeNull();
    expect(verifySequenceUnsubscribeToken(sequence, "x".repeat(32))).toBeNull();
  });

  it("también vence a los 730 días", () => {
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const token = signSequenceUnsubscribeToken(ID, SECRET, issuedAt);
    const justAfter = new Date(issuedAt.getTime() + 730 * DAY + 1000);
    expect(verifySequenceUnsubscribeToken(token, SECRET, justAfter)).toBeNull();
  });
});
