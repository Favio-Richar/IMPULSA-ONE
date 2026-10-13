import { describe, expect, it } from "vitest";
import { THEME_CATALOG } from "./catalog.js";
import { themeTokensToCssVariables } from "./css-variables.js";
import { FONT_FAMILY_META, FONT_STYLE_GROUPS } from "./fonts.js";
import { FONT_FAMILIES, themeTokensSchema } from "./tokens.js";

describe("catálogo de tipografías (extra F10)", () => {
  it("es un enum cerrado de 18 familias, sin repetidos", () => {
    expect(FONT_FAMILIES).toHaveLength(18);
    expect(new Set(FONT_FAMILIES).size).toBe(18);
  });

  it("cada familia tiene su presentación y su grupo, y cada grupo tiene familias", () => {
    const groups = new Set<string>(FONT_STYLE_GROUPS.map((group) => group.id));
    for (const family of FONT_FAMILIES) {
      const meta = FONT_FAMILY_META[family];
      expect(meta.label.length, family).toBeGreaterThan(0);
      expect(meta.description.length, family).toBeGreaterThan(0);
      expect(groups.has(meta.group), family).toBe(true);
    }
    for (const group of FONT_STYLE_GROUPS) {
      expect(FONT_FAMILIES.some((family) => FONT_FAMILY_META[family].group === group.id), group.id).toBe(true);
    }
    expect(Object.keys(FONT_FAMILY_META).sort()).toEqual([...FONT_FAMILIES].sort());
  });

  it("toda familia produce una pila válida que termina en una genérica, para títulos y texto", () => {
    const base = THEME_CATALOG[0]!.tokens;
    for (const fontFamily of FONT_FAMILIES) {
      const vars = themeTokensToCssVariables({ ...base, fontFamily });
      for (const stack of [vars["--site-font-family"], vars["--site-font-heading"]]) {
        expect(stack, fontFamily).toMatch(/(sans-serif|serif)$/);
        // Sin nada que pueda cerrar una declaración e inyectar otra: solo nombres entre comillas y comas.
        expect(stack, fontFamily).not.toMatch(/[;{}<>]/);
      }
    }
  });

  it("un tema con cualquiera de las nuevas tipografías sigue pasando el esquema (la paleta no cambia)", () => {
    const base = THEME_CATALOG[0]!.tokens;
    for (const fontFamily of FONT_FAMILIES) {
      expect(themeTokensSchema.safeParse({ ...base, fontFamily }).success, fontFamily).toBe(true);
    }
    expect(themeTokensSchema.safeParse({ ...base, fontFamily: "comic-sans" }).success).toBe(false);
  });
});
