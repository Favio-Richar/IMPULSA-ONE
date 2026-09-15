import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("hashPassword / verifyPassword", () => {
  it("genera un hash Argon2id verificable con la contraseña correcta", async () => {
    const hash = await hashPassword("una-contraseña-segura-123");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "una-contraseña-segura-123")).resolves.toBe(true);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const hash = await hashPassword("una-contraseña-segura-123");
    await expect(verifyPassword(hash, "otra-contraseña")).resolves.toBe(false);
  });

  it("nunca guarda la contraseña en texto plano dentro del hash", async () => {
    const plain = "contraseña-super-secreta";
    const hash = await hashPassword(plain);
    expect(hash).not.toContain(plain);
  });

  it("no lanza con un hash con formato corrupto — trata como inválido", async () => {
    await expect(verifyPassword("no-es-un-hash-argon2", "cualquiera")).resolves.toBe(false);
  });
});
