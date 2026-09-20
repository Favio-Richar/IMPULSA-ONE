import { describe, expect, it } from "vitest";
import {
  BUTTON_STYLES,
  DENSITY_SCALES,
  FONT_FAMILIES,
  RADIUS_SCALES,
  SHADOW_SCALES,
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
});
