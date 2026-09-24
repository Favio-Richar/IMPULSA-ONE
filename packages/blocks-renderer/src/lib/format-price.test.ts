import { describe, expect, it } from "vitest";
import { formatPrice } from "./format-price.js";

// Intl usa espacios duros entre símbolo y número según la moneda; se normalizan para comparar.
const plain = (value: string) => value.replace(/\s/g, " ");

describe("formatPrice", () => {
  it("no divide pesos chilenos: la unidad mínima del CLP es el peso", () => {
    expect(plain(formatPrice(12900, "CLP"))).toBe("$12.900");
  });

  it("divide por 100 en monedas con centavos", () => {
    expect(plain(formatPrice(1999, "USD"))).toBe("US$19,99");
  });

  it("respeta monedas con tres decimales", () => {
    expect(plain(formatPrice(1500, "KWD"))).toMatch(/1,500/);
  });
});
