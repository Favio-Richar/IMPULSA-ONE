import { describe, expect, it } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("quita tildes, símbolos y espacios", () => {
    expect(slugify("Café Aroma & Co.")).toBe("cafe-aroma-co");
    expect(slugify("  Ñandú   Tours  ")).toBe("nandu-tours");
  });

  it("nunca deja guiones al inicio ni al final, ni pasa de 63 caracteres", () => {
    expect(slugify("--Hola--")).toBe("hola");
    const long = slugify("a".repeat(62) + " b");
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith("-")).toBe(false);
  });
});
