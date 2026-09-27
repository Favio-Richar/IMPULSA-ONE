import { describe, expect, it } from "vitest";
import { signBookingLinkToken, verifyBookingLinkToken } from "./booking-link.js";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-link.js";

const SECRET = "s".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";

describe("enlace de baja de campañas (F5.6/F5.7)", () => {
  it("un enlace firmado se verifica y devuelve el id del destinatario", () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(ID, SECRET), SECRET)).toBe(ID);
  });

  it("no se puede fabricar: otra firma, otro id, otro secreto o basura dan null", () => {
    const token = signUnsubscribeToken(ID, SECRET);
    const otherId = "22222222-2222-4222-8222-222222222222";
    expect(verifyUnsubscribeToken(`${otherId}.${token.split(".")[1]}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${ID}.${token.split(".")[1]!.slice(0, -1)}A`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${token}a`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(token, "x".repeat(32))).toBeNull();
    for (const junk of ["", ".", ID, `${ID}.`, "no-es-uuid.abc", `${"a".repeat(300)}.b`]) {
      expect(verifyUnsubscribeToken(junk, SECRET), junk).toBeNull();
    }
  });

  it("comparte secreto con la gestión de reservas pero no la firma: ninguna sirve por la otra", () => {
    expect(verifyUnsubscribeToken(signBookingLinkToken(ID, SECRET), SECRET)).toBeNull();
    expect(verifyBookingLinkToken(signUnsubscribeToken(ID, SECRET), SECRET)).toBeNull();
  });
});
