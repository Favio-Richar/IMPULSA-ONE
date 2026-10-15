import { describe, expect, it } from "vitest";
import {
  BUTTON_STYLES,
  DENSITY_SCALES,
  FONT_FAMILIES,
  RADIUS_SCALES,
  SHADOW_SCALES,
  themeTokensSchema,
} from "./tokens.js";
import { THEME_CATALOG } from "./catalog.js";
import { themeTokensToCssVariables } from "./css-variables.js";

const baseTokens = THEME_CATALOG[0]!.tokens;

describe("themeTokensToCssVariables (F2.7)", () => {
  it("traduce la paleta 1:1, sin transformar los colores", () => {
    const vars = themeTokensToCssVariables(baseTokens);

    expect(vars["--site-color-background"]).toBe(baseTokens.palette.background);
    expect(vars["--site-color-surface"]).toBe(baseTokens.palette.surface);
    expect(vars["--site-color-foreground"]).toBe(baseTokens.palette.foreground);
    expect(vars["--site-color-muted-foreground"]).toBe(baseTokens.palette.mutedForeground);
    expect(vars["--site-color-primary"]).toBe(baseTokens.palette.primary);
    expect(vars["--site-color-primary-foreground"]).toBe(baseTokens.palette.primaryForeground);
    expect(vars["--site-color-border"]).toBe(baseTokens.palette.border);
  });

  it("cubre todos los valores posibles de cada enum sin lanzar ni devolver undefined", () => {
    // Recorre el producto de enums reales del esquema (F2.5), no una muestra elegida a mano: si
    // se agrega un valor nuevo a RADIUS_SCALES/SHADOW_SCALES/etc. sin mapearlo acá, esta prueba
    // falla con `undefined` en vez de fallar en silencio en el render público.
    for (const fontFamily of FONT_FAMILIES) {
      for (const radius of RADIUS_SCALES) {
        for (const density of DENSITY_SCALES) {
          for (const shadow of SHADOW_SCALES) {
            for (const buttonStyle of BUTTON_STYLES) {
              const vars = themeTokensToCssVariables({
                ...baseTokens,
                fontFamily,
                radius,
                density,
                shadow,
                buttonStyle,
              });

              for (const value of Object.values(vars)) {
                expect(value, `${fontFamily}/${radius}/${density}/${shadow}`).toBeTruthy();
              }
            }
          }
        }
      }
    }
  });

  it("nunca deja un radio ni una sombra pesados (dirección visual obligatoria, CLAUDE.md)", () => {
    for (const theme of THEME_CATALOG) {
      const vars = themeTokensToCssVariables(theme.tokens);

      // "Bordes moderados": ningún radio calculado debería superar 1rem en esta escala cerrada.
      expect(Number.parseFloat(vars["--site-radius"])).toBeLessThanOrEqual(1);
      // "Sombras discretas": nunca más de dos capas de sombra.
      expect(vars["--site-shadow"].split(",").length).toBeLessThanOrEqual(2);
    }
  });

  it("ADR-031: cuatro radios y cuatro sombras; «redondeado» no llega a píldora y la sólida toma el texto de la página", () => {
    expect(RADIUS_SCALES).toEqual(["none", "subtle", "moderate", "rounded"]);
    expect(SHADOW_SCALES).toEqual(["none", "subtle", "strong", "hard"]);
    const radii = RADIUS_SCALES.map((radius) => Number.parseFloat(themeTokensToCssVariables({ ...baseTokens, radius })["--site-radius"]));
    // Escala estrictamente creciente, y el mayor por debajo de la mitad de un botón de la pila (56 px = 3.5rem).
    expect([...radii].sort((a, b) => a - b)).toEqual(radii);
    expect(new Set(radii).size).toBe(radii.length);
    expect(radii.at(-1)!).toBeLessThan(1.75);
    // El color del texto de la página (ajustado por el fondo para AA), no el del tema: visible sobre fondo claro y oscuro.
    expect(themeTokensToCssVariables({ ...baseTokens, shadow: "hard" })["--site-shadow"]).toBe("4px 4px 0 0 var(--site-color-foreground)");
    expect(themeTokensToCssVariables({ ...baseTokens, shadow: "strong" })["--site-shadow"]).toMatch(/^0 12px 28px/);
    // Un tema guardado antes (sutil/moderado) se pinta exactamente igual que siempre.
    expect(themeTokensToCssVariables({ ...baseTokens, radius: "moderate", shadow: "subtle" })).toMatchObject({
      "--site-radius": "0.75rem",
      "--site-shadow": "0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.08)",
    });
  });

  it("fuente de títulos independiente: sin la clave nada cambia; con ella, solo los títulos usan la otra fuente", () => {
    for (const fontFamily of FONT_FAMILIES) {
      const before = themeTokensToCssVariables({ ...baseTokens, fontFamily });
      // Un tema guardado sin `headingFontFamily` (o con la misma) se pinta igual que siempre.
      expect(themeTokensToCssVariables({ ...baseTokens, fontFamily, headingFontFamily: undefined })).toEqual(before);
      expect(themeTokensToCssVariables({ ...baseTokens, fontFamily, headingFontFamily: fontFamily })).toEqual(before);
    }
    const mixed = themeTokensToCssVariables({ ...baseTokens, fontFamily: "dmsans", headingFontFamily: "playfair" });
    expect(mixed["--site-font-family"]).toContain("DM Sans Variable");
    expect(mixed["--site-font-heading"]).toContain("Playfair Display Variable");
    expect(themeTokensSchema.safeParse({ ...baseTokens, headingFontFamily: "playfair" }).success).toBe(true);
    expect(themeTokensSchema.safeParse({ ...baseTokens, headingFontFamily: "Comic Sans MS" }).success).toBe(false);
  });

  it("las parejas tipográficas (PP4) separan títulos y texto, y siempre caen a una fuente del sistema", () => {
    for (const fontFamily of ["executive", "vibrant"] as const) {
      const vars = themeTokensToCssVariables({ ...baseTokens, fontFamily });

      expect(vars["--site-font-heading"]).not.toBe(vars["--site-font-family"]);
      // Si la fuente propia no llega (red lenta, bloqueada), el texto se sigue viendo bien.
      expect(vars["--site-font-family"]).toMatch(/(sans-serif|serif)$/);
      expect(vars["--site-font-heading"]).toMatch(/(sans-serif|serif)$/);
    }
  });

  it("las familias del sistema usan la misma fuente en títulos y texto (nada cambia en temas previos)", () => {
    for (const fontFamily of ["system", "serif", "geometric", "humanist"] as const) {
      const vars = themeTokensToCssVariables({ ...baseTokens, fontFamily });
      expect(vars["--site-font-heading"]).toBe(vars["--site-font-family"]);
    }
  });
});
