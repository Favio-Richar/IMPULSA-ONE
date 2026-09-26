import { describe, expect, it } from "vitest";
import { signBookingLinkToken, verifyBookingLinkToken } from "./booking-link.js";

const SECRET = "s".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";

describe("enlace de gestión de reserva (F5.4)", () => {
  it("un enlace firmado se verifica y devuelve el id", () => {
    expect(verifyBookingLinkToken(signBookingLinkToken(ID, SECRET), SECRET)).toBe(ID);
  });

  it("no se puede fabricar: otra firma, otro id, otro secreto o basura dan null", () => {
    const token = signBookingLinkToken(ID, SECRET);
    const otherId = "22222222-2222-4222-8222-222222222222";
    expect(verifyBookingLinkToken(`${otherId}.${token.split(".")[1]}`, SECRET)).toBeNull();
    expect(verifyBookingLinkToken(`${ID}.${token.split(".")[1]!.slice(0, -1)}A`, SECRET)).toBeNull();
    expect(verifyBookingLinkToken(token, "x".repeat(32))).toBeNull();
    for (const junk of ["", ".", ID, `${ID}.`, "no-es-uuid.abc", `${"a".repeat(300)}.b`]) {
      expect(verifyBookingLinkToken(junk, SECRET), junk).toBeNull();
    }
  });
});
