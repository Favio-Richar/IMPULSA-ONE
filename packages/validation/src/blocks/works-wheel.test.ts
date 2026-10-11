import { describe, expect, it } from "vitest";
import { worksWheelSchema, WORKS_WHEEL_MAX_ITEMS, WORKS_WHEEL_MIN_ITEMS } from "./catalog.js";

// Rueda de trabajos: el negocio administra piezas (imagen, nombre y enlace opcional); el esquema acota
// cuántas, exige descripción de imagen y rechaza enlaces peligrosos.

const piece = (n: number, extra: Record<string, unknown> = {}) => ({
  title: `Trabajo ${n}`,
  image: { url: `https://cdn.ejemplo.cl/${n}.jpg`, alt: `Imagen ${n}` },
  ...extra,
});
const pieces = (count: number) => Array.from({ length: count }, (_, index) => piece(index + 1));

describe("bloque rueda de trabajos", () => {
  it("acepta de 3 a 16 piezas y completa los textos por defecto", () => {
    const parsed = worksWheelSchema.parse({ items: pieces(WORKS_WHEEL_MIN_ITEMS) });
    expect(parsed.label).toBe("Mis trabajos");
    expect(parsed.actionLabel).toBe("Ver");
    expect(worksWheelSchema.safeParse({ items: pieces(WORKS_WHEEL_MAX_ITEMS) }).success).toBe(true);
  });

  it("rechaza menos de 3 y más de 16 piezas", () => {
    expect(worksWheelSchema.safeParse({ items: pieces(WORKS_WHEEL_MIN_ITEMS - 1) }).success).toBe(false);
    expect(worksWheelSchema.safeParse({ items: pieces(WORKS_WHEEL_MAX_ITEMS + 1) }).success).toBe(false);
  });

  it("exige el nombre de cada pieza y la descripción de su imagen", () => {
    const items = pieces(3);
    expect(worksWheelSchema.safeParse({ items: [{ ...items[0], title: "" }, items[1], items[2]] }).success).toBe(false);
    expect(worksWheelSchema.safeParse({ items: [{ ...items[0], image: { url: "https://cdn.ejemplo.cl/1.jpg" } }, items[1], items[2]] }).success).toBe(false);
  });

  it("solo admite enlaces http(s): nada de javascript: ni data:", () => {
    const items = pieces(3);
    expect(worksWheelSchema.safeParse({ items: [piece(1, { link: "https://ejemplo.cl/caso" }), items[1], items[2]] }).success).toBe(true);
    expect(worksWheelSchema.safeParse({ items: [piece(1, { link: "javascript:alert(1)" }), items[1], items[2]] }).success).toBe(false);
    expect(worksWheelSchema.safeParse({ items: [piece(1, { image: { url: "data:text/html,x", alt: "x" } }), items[1], items[2]] }).success).toBe(false);
  });
});
