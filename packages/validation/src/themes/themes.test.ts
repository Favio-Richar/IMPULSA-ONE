import { describe, expect, it } from "vitest";
import { AA_NORMAL_TEXT, AA_UI_COMPONENT, contrastRatio } from "../contrast.js";
import { DEFAULT_THEME_CODE, getCatalogTheme, THEME_CATALOG } from "./catalog.js";
import { themeTokensSchema } from "./tokens.js";

const baseTokens = THEME_CATALOG[0]!.tokens;

describe("catálogo de temas (F2.5)", () => {
  it("no hay códigos repetidos y el tema por defecto existe", () => {
    const codes = THEME_CATALOG.map((theme) => theme.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(getCatalogTheme(DEFAULT_THEME_CODE)).toBeDefined();
  });

  it("todo tema del catálogo pasa su propio esquema (incluida la verificación de contraste)", () => {
    for (const theme of THEME_CATALOG) {
      const result = themeTokensSchema.safeParse(theme.tokens);
      expect(
        result.success,
        `${theme.code}: ${result.success ? "" : JSON.stringify(result.error.issues)}`,
      ).toBe(true);
    }
  });

  it("todo tema del catálogo cumple WCAG 2.2 AA en cada par de contraste", () => {
    // Se vuelve a verificar aquí, explícitamente y par por par, en vez de confiar solo en que el
    // esquema lo haga: si alguien relajara la regla del esquema, esta prueba lo delata igual.
    for (const { code, tokens } of THEME_CATALOG) {
      const { palette } = tokens;

      expect(contrastRatio(palette.foreground, palette.background), `${code}: texto/fondo`).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
      expect(
        contrastRatio(palette.mutedForeground, palette.background),
        `${code}: texto secundario/fondo`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      expect(contrastRatio(palette.foreground, palette.surface), `${code}: texto/superficie`).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
      expect(
        contrastRatio(palette.primaryForeground, palette.primary),
        `${code}: texto del botón/botón`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      expect(contrastRatio(palette.primary, palette.background), `${code}: botón/fondo`).toBeGreaterThanOrEqual(
        AA_UI_COMPONENT,
      );
    }
  });

  it("todos los fondos son claros, como exige la dirección visual del proyecto", () => {
    for (const { code, tokens } of THEME_CATALOG) {
      // Fondo blanco o muy claro (CLAUDE.md). Contra negro, un fondo claro da un contraste alto.
      expect(contrastRatio(tokens.palette.background, "#000000"), `${code}: fondo no es claro`).toBeGreaterThan(15);
    }
  });

  it("ningún tema del catálogo usa bordes excesivamente redondos ni sombras pesadas", () => {
    for (const { code, tokens } of THEME_CATALOG) {
      expect(["none", "subtle", "moderate"], `${code}: radio fuera de la escala`).toContain(tokens.radius);
      expect(["none", "subtle"], `${code}: sombra fuera de la escala`).toContain(tokens.shadow);
    }
  });
});

describe("esquema de tokens de tema", () => {
  it("rechaza un tema con contraste insuficiente, indicando el campo", () => {
    const result = themeTokensSchema.safeParse({
      ...baseTokens,
      palette: { ...baseTokens.palette, foreground: "#cccccc" },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "palette.foreground");
      expect(issue?.message).toContain("Contraste insuficiente");
    }
  });

  it("rechaza un botón primario que no se distingue del fondo", () => {
    const result = themeTokensSchema.safeParse({
      ...baseTokens,
      palette: { ...baseTokens.palette, primary: "#fdfdfd", primaryForeground: "#000000" },
    });

    expect(result.success).toBe(false);
  });

  it("no acepta CSS libre en ningún campo de color", () => {
    const payloads = [
      "red; background: url(javascript:alert(1))",
      "var(--x)",
      "url(https://evil.example.com)",
      "expression(alert(1))",
      "#fff",
      "rgb(255,255,255)",
      "transparent",
    ];

    for (const value of payloads) {
      const result = themeTokensSchema.safeParse({
        ...baseTokens,
        palette: { ...baseTokens.palette, primary: value },
      });
      expect(result.success, `debería rechazar el color: ${value}`).toBe(false);
    }
  });

  it("no acepta valores fuera de las escalas cerradas", () => {
    for (const [field, value] of [
      ["fontFamily", "Comic Sans MS"],
      ["radius", "pill"],
      ["density", "gigante"],
      ["shadow", "dramatic"],
      ["buttonStyle", "glassmorphism"],
    ] as const) {
      const result = themeTokensSchema.safeParse({ ...baseTokens, [field]: value });
      expect(result.success, `debería rechazar ${field}=${value}`).toBe(false);
    }
  });

  it("normaliza el hex a minúsculas para que dos temas iguales no difieran por la caja", () => {
    const result = themeTokensSchema.safeParse({
      ...baseTokens,
      palette: { ...baseTokens.palette, primary: "#4338CA" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.palette.primary).toBe("#4338ca");
    }
  });
});
