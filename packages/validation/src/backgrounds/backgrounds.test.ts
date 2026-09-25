import { describe, expect, it } from "vitest";
import { AA_NORMAL_TEXT, contrastRatio } from "../contrast.js";
import { THEME_CATALOG } from "../themes/catalog.js";
import {
  BACKGROUND_GRADIENTS,
  backgroundTextCssVariables,
  blendHex,
  colorTextPalette,
  isOverlayLegible,
  legibleStrengths,
  ON_BACKGROUND_TEXT,
  OVERLAY_TONES,
  resolveSiteBackground,
  siteBackgroundSchema,
  UNKNOWN_IMAGE_TONES,
} from "./index.js";

const theme = THEME_CATALOG[0]!.tokens;
const noVideo = () => {
  throw new Error("no debería pedir URLs de video");
};

describe("paletas de texto sobre el fondo", () => {
  it("la clara y la oscura alcanzan AA sobre sus extremos (negro y blanco)", () => {
    for (const color of [ON_BACKGROUND_TEXT.light.foreground, ON_BACKGROUND_TEXT.light.mutedForeground]) {
      expect(contrastRatio(color, "#000000")).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
    for (const color of [ON_BACKGROUND_TEXT.dark.foreground, ON_BACKGROUND_TEXT.dark.mutedForeground]) {
      expect(contrastRatio(color, "#ffffff")).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });
});

describe("degradados del catálogo", () => {
  it("cada degradado se lee con su paleta en todos sus colores", () => {
    for (const gradient of BACKGROUND_GRADIENTS) {
      const palette = ON_BACKGROUND_TEXT[gradient.text];
      for (const stop of gradient.stops) {
        expect(contrastRatio(palette.foreground, stop), `${gradient.code} ${stop}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        expect(contrastRatio(palette.mutedForeground, stop), `${gradient.code} ${stop}`).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    }
  });

  it("los códigos son únicos", () => {
    expect(new Set(BACKGROUND_GRADIENTS.map((gradient) => gradient.code)).size).toBe(BACKGROUND_GRADIENTS.length);
  });
});

describe("capa de legibilidad", () => {
  it("mezcla como CSS: 50 % de negro sobre blanco es gris medio", () => {
    expect(blendHex("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(blendHex("#123456", "#ffffff", 0)).toBe("#123456");
  });

  it("la intensidad fuerte se lee sobre cualquier imagen, así que siempre hay una opción válida", () => {
    for (const tone of OVERLAY_TONES) {
      expect(isOverlayLegible(UNKNOWN_IMAGE_TONES, { tone, strength: "strong" })).toBe(true);
      expect(isOverlayLegible(null, { tone, strength: "strong" })).toBe(true);
    }
  });

  it("sobre una foto con zonas blancas, una capa oscura suave no alcanza", () => {
    const bright = { darkest: "#1f2937", lightest: "#fafafa" };
    expect(isOverlayLegible(bright, { tone: "dark", strength: "soft" })).toBe(false);
    expect(legibleStrengths(bright, "dark")).toEqual(["strong"]);
  });

  it("sobre una foto oscura, la capa oscura suave basta", () => {
    const night = { darkest: "#020617", lightest: "#3f3f46" };
    expect(legibleStrengths(night, "dark")).toEqual(["soft", "medium", "strong"]);
  });
});

describe("fondo de color", () => {
  it("usa el texto del tema si alcanza, y si no el claro o el oscuro", () => {
    expect(colorTextPalette(theme.palette.background, theme)).toBe("theme");
    expect(colorTextPalette("#0b1f3a", theme)).toBe("light");
    expect(colorTextPalette("#fde68a", null)).toBe("dark");
  });

  it("rechaza un gris medio con el que ningún texto se lee", () => {
    expect(colorTextPalette("#777777", null)).toBeNull();
    expect(siteBackgroundSchema.safeParse({ kind: "color", color: "#777777" }).success).toBe(false);
    expect(siteBackgroundSchema.safeParse({ kind: "color", color: "#0b1f3a" }).success).toBe(true);
  });
});

describe("siteBackgroundSchema", () => {
  it("solo acepta valores cerrados, nunca CSS", () => {
    expect(siteBackgroundSchema.safeParse({ kind: "gradient", gradient: "medianoche" }).success).toBe(true);
    expect(siteBackgroundSchema.safeParse({ kind: "gradient", gradient: "linear-gradient(red, blue)" }).success).toBe(false);
    expect(siteBackgroundSchema.safeParse({ kind: "color", color: "red;background:url(x)" }).success).toBe(false);
    expect(siteBackgroundSchema.safeParse({ kind: "image", image: { url: "javascript:alert(1)" }, overlay: { tone: "dark", strength: "strong" } }).success).toBe(false);
  });

  it("un video que no está en la biblioteca curada se rechaza", () => {
    expect(siteBackgroundSchema.safeParse({ kind: "video", video: "cualquiera", overlay: { tone: "dark", strength: "strong" } }).success).toBe(false);
  });
});

describe("resolveSiteBackground", () => {
  it("resuelve la paleta de texto de cada tipo", () => {
    expect(resolveSiteBackground({ kind: "gradient", gradient: "bosque" }, theme, noVideo)).toEqual({ kind: "gradient", gradient: "bosque", text: "light" });
    expect(
      resolveSiteBackground({ kind: "image", image: { url: "https://x.test/a.webp" }, overlay: { tone: "light", strength: "strong" } }, theme, noVideo),
    ).toMatchObject({ kind: "image", text: "dark" });
  });

  it("un fondo guardado que ya no es válido cae al del tema en vez de romper la página", () => {
    expect(resolveSiteBackground({ kind: "gradient", gradient: "retirado" }, theme, noVideo)).toBeNull();
    expect(resolveSiteBackground(null, theme, noVideo)).toBeNull();
  });

  it("con la paleta del tema no cambia ninguna variable; con otra, el texto y los enlaces", () => {
    expect(backgroundTextCssVariables("theme")).toEqual({});
    expect(backgroundTextCssVariables("light")).toMatchObject({ "--site-color-foreground": "#ffffff", "--site-color-link": "#ffffff" });
  });
});
