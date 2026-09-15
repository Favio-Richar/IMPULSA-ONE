import { describe, expect, it } from "vitest";
import { generateVerificationToken, hashToken } from "./tokens.js";

describe("generateVerificationToken", () => {
  it("genera un token crudo distinto de su hash", () => {
    const { raw, hash } = generateVerificationToken();
    expect(raw).not.toBe(hash);
    expect(raw).toHaveLength(64);
    expect(hash).toHaveLength(64);
  });

  it("dos tokens generados nunca coinciden (suficiente entropía)", () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a.raw).not.toBe(b.raw);
  });

  it("hashToken es determinístico — permite buscar por hash al validar", () => {
    const { raw, hash } = generateVerificationToken();
    expect(hashToken(raw)).toBe(hash);
  });
});
