import { describe, expect, it } from "vitest";
import { sameConfig } from "./same-config";

describe("sameConfig", () => {
  it("el eco del servidor con las claves reordenadas (JSONB) es el mismo valor", () => {
    const sent = { title: "Hola", subtitle: "Sub", background: { url: "https://x.test/a.webp", alt: "" }, alignment: "left" };
    const echo = { title: "Hola", subtitle: "Sub", alignment: "left", background: { alt: "", url: "https://x.test/a.webp" } };
    expect(sameConfig(echo, sent)).toBe(true);
  });

  it("detecta un cambio real, también dentro de listas", () => {
    expect(sameConfig({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameConfig({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameConfig({ items: [{ q: "a" }, { q: "b" }] }, { items: [{ q: "b" }, { q: "a" }] })).toBe(false);
    expect(sameConfig({ items: [1] }, { items: [1, 2] })).toBe(false);
    expect(sameConfig({ a: null }, { a: {} })).toBe(false);
  });

  it("una clave con undefined cuenta como ausente", () => {
    expect(sameConfig({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});
