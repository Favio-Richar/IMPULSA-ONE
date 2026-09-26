import { describe, expect, it } from "vitest";
import { AA_NORMAL_TEXT, contrastRatio } from "../contrast.js";
import { THEME_CATALOG } from "../themes/catalog.js";
import { themeTokensToCssVariables } from "../themes/css-variables.js";
import {
  BACKGROUND_GRADIENTS,
  backgroundForDisplay,
  backgroundTextCssVariables,
  blendHex,
  legibleStrengths,
  OVERLAY_ALPHA,
  OVERLAY_COLORS,
  OVERLAY_TONES,
  resolveSiteBackground,
  UNKNOWN_IMAGE_TONES,
  type ResolvedSiteBackground,
} from "./index.js";

// Matriz completa tema × fondo (PL2, ADR-008): cada tema del catálogo sobre cada fondo que ofrece el
// producto, con los colores **tal como los pinta el render** (variables CSS del tema, cambiadas por
// las del fondo donde corresponde). Se verifica WCAG 2.2 AA en cada par de texto que aparece:
//
// - texto directo sobre el fondo (nombre, frase, párrafos) y enlaces de texto, contra **cada color**
//   del fondo (los dos extremos de un degradado; el peor tono de una foto bajo su capa);
// - dentro de tarjetas y botones, la paleta del tema (vuelve con `SURFACE_SCOPE`).
//
// Si un tema o un fondo nuevo rompe una combinación, esta prueba dice cuál.

const WHITE = "#ffffff";

/** Colores sobre los que puede quedar texto directo con este fondo (peor caso). */
function backdropColors(background: ResolvedSiteBackground | null, themeBackground: string): string[] {
  if (!background) return [themeBackground];
  switch (background.kind) {
    case "color":
      return [background.color];
    case "gradient":
      return [...BACKGROUND_GRADIENTS.find((gradient) => gradient.code === background.gradient)!.stops];
    case "image":
    case "video": {
      // Foto desconocida: se mezcla la capa sobre sus extremos posibles (negro y blanco).
      const overlay = OVERLAY_COLORS[background.overlay.tone];
      const alpha = OVERLAY_ALPHA[background.overlay.tone][background.overlay.strength];
      return [UNKNOWN_IMAGE_TONES.darkest, UNKNOWN_IMAGE_TONES.lightest].map((tone) => blendHex(tone, overlay, alpha));
    }
  }
}

const BACKGROUNDS: Array<{ name: string; stored: unknown }> = [
  { name: "del tema", stored: null },
  ...BACKGROUND_GRADIENTS.map((gradient) => ({ name: `degradado ${gradient.code}`, stored: { kind: "gradient", gradient: gradient.code } })),
  { name: "color oscuro", stored: { kind: "color", color: "#0b1f3a" } },
  { name: "color claro", stored: { kind: "color", color: "#fef3c7" } },
  // Sobre una foto cualquiera solo se acepta una capa que alcance AA en el peor punto: la fuerte.
  ...OVERLAY_TONES.map((tone) => ({
    name: `imagen con capa ${tone} fuerte`,
    stored: { kind: "image", image: { url: "https://media.test/org/x/y/w1600.webp" }, overlay: { tone, strength: "strong" } },
  })),
];

describe("matriz tema × fondo (PL2, ADR-008): WCAG 2.2 AA en cada combinación", () => {
  for (const theme of THEME_CATALOG) {
    for (const background of BACKGROUNDS) {
      it(`${theme.code} sobre ${background.name}`, () => {
        const resolved = resolveSiteBackground(backgroundForDisplay(background.stored, theme.code), theme.tokens, (key) => key);
        const vars = {
          ...themeTokensToCssVariables(theme.tokens),
          ...(resolved ? backgroundTextCssVariables(resolved.text) : {}),
        } as Record<string, string>;
        const text = [vars["--site-color-foreground"]!, vars["--site-color-muted-foreground"]!, vars["--site-color-link"]!];

        for (const backdrop of backdropColors(resolved, theme.tokens.palette.background)) {
          for (const color of text) {
            expect(contrastRatio(color, backdrop), `${color} sobre ${backdrop}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
          }
        }

        // Tarjetas y botones: la paleta del tema, que no cambia con el fondo.
        const { palette } = theme.tokens;
        expect(contrastRatio(palette.foreground, palette.surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        expect(contrastRatio(palette.mutedForeground, palette.surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        expect(contrastRatio(palette.primaryForeground, palette.primary)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }

  it("con una foto cualquiera, toda intensidad que el sistema acepta alcanza AA en el peor punto", () => {
    for (const tone of OVERLAY_TONES) {
      const textColor = tone === "dark" ? WHITE : "#0f172a";
      const accepted = legibleStrengths(null, tone);
      expect(accepted, tone).toContain("strong");
      for (const strength of accepted) {
        for (const extreme of [UNKNOWN_IMAGE_TONES.darkest, UNKNOWN_IMAGE_TONES.lightest]) {
          const backdrop = blendHex(extreme, OVERLAY_COLORS[tone], OVERLAY_ALPHA[tone][strength]);
          expect(contrastRatio(textColor, backdrop), `${tone} ${strength} sobre ${extreme}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }
      }
    }
  });

  it("un tema oscuro sin fondo propio se ve con su degradado; con fondo elegido, manda el elegido", () => {
    expect(backgroundForDisplay(null, "oscuro-indigo")).toEqual({ kind: "gradient", gradient: "medianoche" });
    expect(backgroundForDisplay(null, "claro-profesional")).toBeNull();
    expect(backgroundForDisplay(null, null)).toBeNull();
    const own = { kind: "gradient", gradient: "arena" };
    expect(backgroundForDisplay(own, "oscuro-indigo")).toBe(own);
  });
});
