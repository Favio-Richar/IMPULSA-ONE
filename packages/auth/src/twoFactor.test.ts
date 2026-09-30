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

  it("acepta el código de la ventana anterior (llegó justo después del cambio), pero no uno más viejo ni uno futuro", async () => {
    const { secret } = generateTwoFactorSecret("usuario@impulza.dev");
    // Instante fijo, en el segundo 1 de una ventana de 30 s.
    const now = Math.floor(Date.UTC(2026, 8, 29, 12, 0, 1) / 1000);
    const previous = await generate({ secret, epoch: now - 30 });
    const older = await generate({ secret, epoch: now - 61 });
    const future = await generate({ secret, epoch: now + 30 });
    await expect(verifyTwoFactorCode(secret, previous, now)).resolves.toBe(true);
    await expect(verifyTwoFactorCode(secret, older, now)).resolves.toBe(false);
    await expect(verifyTwoFactorCode(secret, future, now)).resolves.toBe(false);
  });
});
