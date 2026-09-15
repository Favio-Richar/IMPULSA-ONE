import { describe, expect, it } from "vitest";
import { generate } from "otplib";
import { generateTwoFactorSecret, verifyTwoFactorCode } from "./twoFactor.js";

describe("generateTwoFactorSecret / verifyTwoFactorCode", () => {
  it("genera un secreto y una URL otpauth válida para ese secreto", () => {
    const { secret, otpauthUrl } = generateTwoFactorSecret("usuario@impulza.dev");
    expect(secret.length).toBeGreaterThan(0);
    expect(otpauthUrl).toContain("otpauth://totp/");
    expect(otpauthUrl).toContain(secret);
  });

  it("acepta un código TOTP válido generado con el mismo secreto", async () => {
    const { secret } = generateTwoFactorSecret("usuario@impulza.dev");
    const code = await generate({ secret });
    await expect(verifyTwoFactorCode(secret, code)).resolves.toBe(true);
  });

  it("rechaza un código incorrecto", async () => {
    const { secret } = generateTwoFactorSecret("usuario@impulza.dev");
    await expect(verifyTwoFactorCode(secret, "000000")).resolves.toBe(false);
  });
});
