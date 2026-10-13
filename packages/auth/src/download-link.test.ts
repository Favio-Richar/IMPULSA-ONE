import { describe, expect, it } from "vitest";
import { signBookingLinkToken } from "./booking-link.js";
import { signOrderDownloadToken, verifyOrderDownloadToken } from "./download-link.js";
import { signUnsubscribeToken } from "./unsubscribe-link.js";

const SECRET = "s".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";
const DAY = 24 * 60 * 60 * 1000;

describe("enlace de descarga de un pedido (F5.11b)", () => {
  it("un enlace firmado se verifica y devuelve el id del pedido", () => {
    expect(verifyOrderDownloadToken(signOrderDownloadToken(ID, SECRET), SECRET)).toBe(ID);
  });

  it("no se puede fabricar: otra firma, otro id, otro secreto o basura dan null", () => {
    const token = signOrderDownloadToken(ID, SECRET);
    const [, issuedAt, signature] = token.split(".");
    expect(verifyOrderDownloadToken(`22222222-2222-4222-8222-222222222222.${issuedAt}.${signature}`, SECRET)).toBeNull();
    expect(verifyOrderDownloadToken(`${ID}.${issuedAt}.${signature!.slice(0, -1)}A`, SECRET)).toBeNull();
    expect(verifyOrderDownloadToken(token, "x".repeat(32))).toBeNull();
    for (const junk of ["", ".", ID, `${ID}.`, "no-es-uuid.abc.def", `${"a".repeat(300)}.b.c`]) {
      expect(verifyOrderDownloadToken(junk, SECRET), junk).toBeNull();
    }
  });

  it("una firma de reserva o de baja con el mismo id no sirve como descarga", () => {
    expect(verifyOrderDownloadToken(signBookingLinkToken(ID, SECRET), SECRET)).toBeNull();
    expect(verifyOrderDownloadToken(signUnsubscribeToken(ID, SECRET), SECRET)).toBeNull();
  });

  it("vence a los 180 días: justo antes sigue valiendo, justo después ya no (decisión del propietario, 2026-10-13)", () => {
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const token = signOrderDownloadToken(ID, SECRET, issuedAt);

    const justBefore = new Date(issuedAt.getTime() + 180 * DAY - 1000);
    expect(verifyOrderDownloadToken(token, SECRET, justBefore)).toBe(ID);

    const justAfter = new Date(issuedAt.getTime() + 180 * DAY + 1000);
    expect(verifyOrderDownloadToken(token, SECRET, justAfter)).toBeNull();
  });
});
