import { describe, expect, it } from "vitest";
import { signBookingLinkToken } from "./booking-link.js";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-link.js";

const ID = "3f1c2b8a-5d4e-4f6a-9b7c-1e2d3c4b5a69";
const SECRET = "s".repeat(32);

describe("enlace de baja firmado (F5.6)", () => {
  it("verifica su propia firma y rechaza otra clave o una firma alterada", () => {
    const token = signUnsubscribeToken(ID, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe(ID);
    expect(verifyUnsubscribeToken(token, "x".repeat(32))).toBeNull();
    expect(verifyUnsubscribeToken(`${token}a`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken("no-es-un-token", SECRET)).toBeNull();
  });

  it("una firma de 'gestiona tu reserva' no sirve como baja", () => {
    expect(verifyUnsubscribeToken(signBookingLinkToken(ID, SECRET), SECRET)).toBeNull();
  });
});
