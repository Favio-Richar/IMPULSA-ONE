import { describe, expect, it } from "vitest";
import { signBookingLinkToken } from "./booking-link.js";
import { signOrderDownloadToken, verifyOrderDownloadToken } from "./download-link.js";
import { signUnsubscribeToken } from "./unsubscribe-link.js";

const SECRET = "s".repeat(32);
const ID = "11111111-1111-4111-8111-111111111111";

describe("enlace de descarga de un pedido (F5.11b)", () => {
  it("un enlace firmado se verifica y devuelve el id del pedido", () => {
    expect(verifyOrderDownloadToken(signOrderDownloadToken(ID, SECRET), SECRET)).toBe(ID);
  });

  it("no se puede fabricar: otra firma, otro id, otro secreto o basura dan null", () => {
    const token = signOrderDownloadToken(ID, SECRET);
    expect(verifyOrderDownloadToken(`22222222-2222-4222-8222-222222222222.${token.split(".")[1]}`, SECRET)).toBeNull();
    expect(verifyOrderDownloadToken(`${ID}.${token.split(".")[1]!.slice(0, -1)}A`, SECRET)).toBeNull();
    expect(verifyOrderDownloadToken(token, "x".repeat(32))).toBeNull();
    for (const junk of ["", ".", ID, `${ID}.`, "no-es-uuid.abc", `${"a".repeat(300)}.b`]) {
      expect(verifyOrderDownloadToken(junk, SECRET), junk).toBeNull();
    }
  });

  it("una firma de reserva o de baja con el mismo id no sirve como descarga", () => {
    expect(verifyOrderDownloadToken(signBookingLinkToken(ID, SECRET), SECRET)).toBeNull();
    expect(verifyOrderDownloadToken(signUnsubscribeToken(ID, SECRET), SECRET)).toBeNull();
  });
});
