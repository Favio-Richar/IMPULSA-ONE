import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto.js";

const testKey = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("descifra exactamente lo que se cifró", () => {
    const plain = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(plain, testKey);
    expect(encrypted).not.toContain(plain);
    expect(decryptSecret(encrypted, testKey)).toBe(plain);
  });

  it("cada cifrado usa un IV distinto (no determinístico)", () => {
    const plain = "mismo-secreto";
    const a = encryptSecret(plain, testKey);
    const b = encryptSecret(plain, testKey);
    expect(a).not.toBe(b);
  });

  it("falla al descifrar con una clave distinta", () => {
    const encrypted = encryptSecret("secreto", testKey);
    const otherKey = randomBytes(32).toString("base64");
    expect(() => decryptSecret(encrypted, otherKey)).toThrow();
  });

  it("rechaza una clave que no tenga 32 bytes", () => {
    expect(() => encryptSecret("secreto", Buffer.from("muy-corta").toString("base64"))).toThrow(
      /32 bytes/,
    );
  });
});
