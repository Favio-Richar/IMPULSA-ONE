import { describe, expect, it } from "vitest";
import { AA_NORMAL_TEXT, AA_UI_COMPONENT, contrastRatio } from "@impulza/validation";

// La calculadora de contraste WCAG vive en @impulza/validation y se verifica ahí contra valores
// de referencia de la especificación (contrast.test.ts). Antes estaba duplicada en este archivo;
// se movió en F2.5 para que el mismo verificador audite los tokens del design system, los temas
// del catálogo y los temas propios que crea un usuario — un solo lugar donde puede estar mal.

// Tokens de packages/ui/src/styles/tokens.css — si se cambia un color ahí, actualizar aquí
// también (duplicado intencional: el test debe poder fallar si alguien afloja un color sin
// darse cuenta de que rompe AA).
const tokens = {
  background: "#ffffff",
  surface: "#f7f9f8",
  foreground: "#10201e",
  mutedForeground: "#475569",
  primary: "#0f6f6b",
  primaryForeground: "#ffffff",
  danger: "#b91c1c",
  dangerForeground: "#ffffff",
  success: "#15803d",
  successForeground: "#ffffff",
  warning: "#b45309",
  warningForeground: "#ffffff",
  info: "#0e7490",
  infoForeground: "#ffffff",
  focusRing: "#0f6f6b",
};

describe("contraste WCAG 2.2 AA — pares texto/fondo", () => {
  it.each([
    ["foreground / background", tokens.foreground, tokens.background],
    ["mutedForeground / background", tokens.mutedForeground, tokens.background],
    ["foreground / surface", tokens.foreground, tokens.surface],
    ["primaryForeground / primary", tokens.primaryForeground, tokens.primary],
    ["dangerForeground / danger", tokens.dangerForeground, tokens.danger],
    ["successForeground / success", tokens.successForeground, tokens.success],
    ["warningForeground / warning", tokens.warningForeground, tokens.warning],
    ["infoForeground / info", tokens.infoForeground, tokens.info],
  ])("%s cumple >= 4.5:1 (AA texto normal)", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe("contraste WCAG 2.2 AA — componentes de UI no textuales", () => {
  it.each([["focusRing / background", tokens.focusRing, tokens.background]])(
    "%s cumple >= 3:1 (AA componente UI)",
    (_label, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_UI_COMPONENT);
    },
  );
});
