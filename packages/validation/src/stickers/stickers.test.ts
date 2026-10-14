import { describe, expect, it } from "vitest";
import { stickerSchema } from "../blocks/catalog.js";
import { getSticker, isStickerId, STICKER_CATALOG, STICKER_CATEGORIES, STICKER_IDS } from "./index.js";

describe("catálogo de stickers (extra F10)", () => {
  it("tiene entre 40 y 60 decoraciones, sin ids repetidos y con id estable (minúsculas y guiones)", () => {
    expect(STICKER_CATALOG.length).toBeGreaterThanOrEqual(40);
    expect(STICKER_CATALOG.length).toBeLessThanOrEqual(60);
    expect(new Set(STICKER_IDS).size).toBe(STICKER_CATALOG.length);
    for (const sticker of STICKER_CATALOG) expect(sticker.id, sticker.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("toda categoría tiene decoraciones y toda decoración pertenece a una categoría", () => {
    const categories = new Set<string>(STICKER_CATEGORIES.map((category) => category.id));
    for (const sticker of STICKER_CATALOG) expect(categories.has(sticker.category), sticker.id).toBe(true);
    for (const category of STICKER_CATEGORIES) {
      expect(STICKER_CATALOG.filter((sticker) => sticker.category === category.id).length, category.id).toBeGreaterThanOrEqual(8);
    }
  });

  it("son datos puros: ningún elemento puede traer marcado, scripts ni referencias externas", () => {
    for (const sticker of STICKER_CATALOG) {
      expect(sticker.elements.length, sticker.id).toBeGreaterThan(0);
      for (const element of sticker.elements) {
        const serialized = JSON.stringify(element);
        expect(serialized, sticker.id).not.toMatch(/<|>|javascript:|https?:|url\(|href/i);
        if (element.type === "path") expect(element.d, sticker.id).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/);
      }
      expect(sticker.name.length, sticker.id).toBeGreaterThan(0);
    }
  });

  it("los textos de los sellos están en español y caben (llevan un ancho al que se ajustan)", () => {
    const seals = STICKER_CATALOG.filter((sticker) => sticker.category === "sellos");
    expect(seals.length).toBeGreaterThanOrEqual(10);
    for (const seal of seals) {
      for (const element of seal.elements) {
        if (element.type === "text") {
          expect(element.fit, `${seal.id}: ${element.text}`).toBeGreaterThan(0);
          expect(element.text, seal.id).toBe(element.text.toUpperCase());
        }
      }
    }
  });

  it("buscar por id: conocido o no", () => {
    expect(getSticker("estrella")?.category).toBe("formas");
    expect(isStickerId("estrella")).toBe(true);
    expect(isStickerId("logo-instagram")).toBe(false);
    expect(getSticker("__proto__")).toBeUndefined();
  });
});

describe("bloque sticker (extra F10)", () => {
  it("valores por defecto y rangos", () => {
    expect(stickerSchema.parse({ stickerId: "flecha-derecha" })).toEqual({ stickerId: "flecha-derecha", size: "md", rotation: 0, alignment: "center", color: "primary" });
    expect(stickerSchema.safeParse({ stickerId: "flecha-derecha", rotation: 31 }).success).toBe(false);
    expect(stickerSchema.safeParse({ stickerId: "flecha-derecha", rotation: -31 }).success).toBe(false);
    expect(stickerSchema.safeParse({ stickerId: "flecha-derecha", rotation: 12.5 }).success).toBe(false);
    expect(stickerSchema.safeParse({ stickerId: "flecha-derecha", size: "xl" }).success).toBe(false);
    expect(stickerSchema.safeParse({ stickerId: "flecha-derecha", alignment: "top" }).success).toBe(false);
  });

  it("solo acepta decoraciones del catálogo (nada subido, nada arbitrario)", () => {
    for (const bad of ["", "mi-logo", "https://ejemplo.cl/a.svg", "<svg onload=alert(1)>", "FLECHA-DERECHA"]) {
      expect(stickerSchema.safeParse({ stickerId: bad }).success, bad).toBe(false);
    }
    expect(stickerSchema.safeParse({}).success).toBe(false);
  });
});
