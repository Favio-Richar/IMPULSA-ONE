import { describe, expect, it } from "vitest";
import { moneyToInput, parseMoneyInput } from "./money-input";

describe("montos escritos a mano", () => {
  it("CLP no tiene decimales: los puntos y comas son separadores de miles", () => {
    expect(parseMoneyInput("12.000", "CLP")).toBe(12000);
    expect(parseMoneyInput(" 12000 ", "CLP")).toBe(12000);
    expect(parseMoneyInput("1.234.567", "CLP")).toBe(1234567);
  });

  it("monedas con decimales aceptan coma o punto decimal", () => {
    expect(parseMoneyInput("19,90", "USD")).toBe(1990);
    expect(parseMoneyInput("19.90", "USD")).toBe(1990);
    expect(parseMoneyInput("1.234,50", "EUR")).toBe(123450);
  });

  it("vacío es null y lo que no es un monto es inválido, nunca un número inventado", () => {
    expect(parseMoneyInput("", "CLP")).toBeNull();
    expect(parseMoneyInput("doce", "CLP")).toBe("invalid");
    expect(parseMoneyInput("-5", "CLP")).toBe("invalid");
    expect(parseMoneyInput("12abc", "USD")).toBe("invalid");
  });

  it("precargar un formulario y volver a leerlo da el mismo monto", () => {
    expect(parseMoneyInput(moneyToInput(12990, "CLP"), "CLP")).toBe(12990);
    expect(parseMoneyInput(moneyToInput(1990, "USD"), "USD")).toBe(1990);
  });
});
