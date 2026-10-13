import { themeTokensSchema, THEME_CATALOG } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { checksFor, describeFailure, formatRatio, paletteContrastChecks, type EditablePalette } from "./theme-contrast";

const GOOD: EditablePalette = {
  background: "#ffffff",
  surface: "#f8fafc",
  foreground: "#0f172a",
  mutedForeground: "#475569",
  primary: "#1d4ed8",
  primaryForeground: "#ffffff",
  border: "#e2e8f0",
};

describe("verificación de contraste del editor de temas", () => {
  it("una paleta válida pasa todos los pares", () => {
    const checks = paletteContrastChecks(GOOD);
    expect(checks).toHaveLength(5);
    expect(checks.every((check) => check.passes)).toBe(true);
  });

  it("coincide con el servidor: todo tema del catálogo pasa aquí igual que pasa el esquema", () => {
    for (const theme of THEME_CATALOG) {
      expect(themeTokensSchema.safeParse(theme.tokens).success).toBe(true);
      expect(paletteContrastChecks(theme.tokens.palette).every((check) => check.passes), theme.code).toBe(true);
    }
  });

  it("lo que aquí no pasa, el servidor lo rechaza con el mismo par (nunca un 422 por sorpresa)", () => {
    const palette: EditablePalette = { ...GOOD, mutedForeground: "#9ca3af" };
    const failing = paletteContrastChecks(palette).filter((check) => !check.passes);
    expect(failing.map((check) => check.id)).toEqual(["muted-background"]);
    const server = themeTokensSchema.safeParse({ ...THEME_CATALOG[0]!.tokens, palette });
    expect(server.success).toBe(false);
    if (!server.success) expect(server.error.issues.map((issue) => issue.path.join("."))).toContain("palette.mutedForeground");
  });

  it("el acento necesita 3:1 sobre el fondo y su texto 4.5:1 sobre el acento", () => {
    const light = paletteContrastChecks({ ...GOOD, primary: "#fde68a" });
    expect(light.find((check) => check.id === "primary-background")?.passes).toBe(false);
    expect(light.find((check) => check.id === "primary-text")?.passes).toBe(false);
  });

  it("un hex incompleto no se calcula y se explica", () => {
    const checks = paletteContrastChecks({ ...GOOD, foreground: "#0f17" });
    const check = checks.find((entry) => entry.id === "text-background")!;
    expect(check.ratio).toBeNull();
    expect(check.passes).toBe(false);
    expect(describeFailure(check)).toBe("Texto principal sobre el fondo: falta un color válido.");
  });

  it("el mensaje trae la razón exacta sin redondear hacia arriba y los umbrales correctos", () => {
    expect(formatRatio(4.4999)).toBe("4.49:1");
    const check = paletteContrastChecks({ ...GOOD, mutedForeground: "#9ca3af" }).find((entry) => entry.id === "muted-background")!;
    expect(describeFailure(check)).toMatch(/^Texto secundario sobre el fondo: \d\.\d\d:1 \(necesita 4\.5:1\)\.$/);
    const ui = paletteContrastChecks({ ...GOOD, primary: "#fde68a" }).find((entry) => entry.id === "primary-background")!;
    expect(describeFailure(ui)).toMatch(/\(necesita 3:1\)\.$/);
  });

  it("cada color sabe en qué pares interviene", () => {
    const checks = paletteContrastChecks(GOOD);
    expect(checksFor("primary", checks).map((check) => check.id).sort()).toEqual(["primary-background", "primary-text"]);
    expect(checksFor("border", checks)).toEqual([]);
  });
});
