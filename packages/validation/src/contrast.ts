// Calculadora de contraste WCAG 2.x (misma fórmula en WCAG 2.2). No delega en una librería
// externa para mantener el mecanismo de auditoría auto-contenido y verificable.
// Referencia: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
//
// Vive en `validation` y no en `ui` porque el servidor también la necesita: un tema propio de una
// organización se valida contra AA al guardarlo (F2.5), no solo los del catálogo. Es una función
// pura, sin dependencias, así que la usan por igual la API, el design system y el constructor.

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Umbrales de WCAG 2.2 nivel AA. */
export const AA_NORMAL_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_UI_COMPONENT = 3;

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

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsAaNormalText(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= AA_NORMAL_TEXT;
}

export function meetsAaUiComponent(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= AA_UI_COMPONENT;
}
