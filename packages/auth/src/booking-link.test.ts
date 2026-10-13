import { describe, expect, it } from "vitest";
import { signBookingLinkToken, verifyBookingLinkToken } from "./booking-link.js";

const SECRET = "s".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const DAY = 24 * 60 * 60 * 1000;

describe("enlace de gestión de reserva (F5.4)", () => {
  it("un enlace firmado se verifica y devuelve el id", () => {
    expect(verifyBookingLinkToken(signBookingLinkToken(ID, SECRET), SECRET)).toBe(ID);
  });

  it("no se puede fabricar: otra firma, otro id, otro secreto o basura dan null", () => {
    const token = signBookingLinkToken(ID, SECRET);
    const otherId = "22222222-2222-4222-8222-222222222222";
    const [, issuedAt, signature] = token.split(".");
    expect(verifyBookingLinkToken(`${otherId}.${issuedAt}.${signature}`, SECRET)).toBeNull();
    expect(verifyBookingLinkToken(`${ID}.${issuedAt}.${signature!.slice(0, -1)}A`, SECRET)).toBeNull();
    expect(verifyBookingLinkToken(token, "x".repeat(32))).toBeNull();
    for (const junk of ["", ".", ID, `${ID}.`, "no-es-uuid.abc.def", `${"a".repeat(300)}.b.c`]) {
      expect(verifyBookingLinkToken(junk, SECRET), junk).toBeNull();
    }
  });

  it("vence a los 90 días: justo antes sigue valiendo, justo después ya no (decisión del propietario, 2026-10-13)", () => {
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const token = signBookingLinkToken(ID, SECRET, issuedAt);

    const justBefore = new Date(issuedAt.getTime() + 90 * DAY - 1000);
    expect(verifyBookingLinkToken(token, SECRET, justBefore)).toBe(ID);

    const justAfter = new Date(issuedAt.getTime() + 90 * DAY + 1000);
    expect(verifyBookingLinkToken(token, SECRET, justAfter)).toBeNull();
  });

  it("una fecha de emisión en el futuro (reloj desfasado o manipulada) no se acepta", () => {
    const issuedAt = new Date("2026-06-01T00:00:00Z");
    const token = signBookingLinkToken(ID, SECRET, issuedAt);
    const before = new Date(issuedAt.getTime() - DAY);
    expect(verifyBookingLinkToken(token, SECRET, before)).toBeNull();
  });
});
