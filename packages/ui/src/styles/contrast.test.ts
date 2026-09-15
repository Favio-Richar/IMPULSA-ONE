import { describe, expect, it } from "vitest";

// Calculadora de contraste WCAG 2.x (misma fórmula en WCAG 2.2) — no delega en una librería
// externa para mantener el mecanismo de auditoría auto-contenido y verificable.
// Referencia: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return [r, g, b];
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const lr = channelToLinear(r);
  const lg = channelToLinear(g);
  const lb = channelToLinear(b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

// Tokens de packages/ui/src/styles/tokens.css — si se cambia un color ahí, actualizar aquí
// también (duplicado intencional: el test debe poder fallar si alguien afloja un color sin
// darse cuenta de que rompe AA).
const tokens = {
  background: "#ffffff",
  surface: "#f8fafc",
  foreground: "#0f172a",
  mutedForeground: "#475569",
  primary: "#4338ca",
  primaryForeground: "#ffffff",
  danger: "#b91c1c",
  dangerForeground: "#ffffff",
  success: "#15803d",
  successForeground: "#ffffff",
  warning: "#b45309",
  warningForeground: "#ffffff",
  info: "#0e7490",
  infoForeground: "#ffffff",
  focusRing: "#4338ca",
};

const AA_NORMAL_TEXT = 4.5;
const AA_UI_COMPONENT = 3.0;

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
