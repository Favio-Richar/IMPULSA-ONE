import { AA_NORMAL_TEXT, AA_UI_COMPONENT, contrastRatio, HEX_COLOR_PATTERN, type ThemeTokens } from "@impulza/validation";

// Verificación de contraste EN VIVO del editor de temas. No es una regla nueva ni una fórmula nueva: son exactamente los mismos
// pares y umbrales que `themeTokensSchema` impone en el servidor (texto 4.5:1 sobre fondo, superficie y acento; acento 3:1 sobre
// el fondo), con `contrastRatio` de `@impulza/validation`. Así la persona ve cada fallo ANTES de guardar y nunca llega a un 422.

export type PaletteKey = keyof ThemeTokens["palette"];
export type EditablePalette = Record<PaletteKey, string>;

export interface ContrastCheck {
  id: string;
  /** Qué se está comprobando, en lenguaje de la persona. */
  label: string;
  foreground: PaletteKey;
  background: PaletteKey;
  /** 4.5 para texto, 3 para elementos de interfaz. */
  required: number;
  /** `null` si alguno de los dos colores todavía no es un hex válido. */
  ratio: number | null;
  passes: boolean;
}

const PAIRS: ReadonlyArray<{ id: string; label: string; foreground: PaletteKey; background: PaletteKey; required: number }> = [
  { id: "text-background", label: "Texto principal sobre el fondo", foreground: "foreground", background: "background", required: AA_NORMAL_TEXT },
  { id: "muted-background", label: "Texto secundario sobre el fondo", foreground: "mutedForeground", background: "background", required: AA_NORMAL_TEXT },
  { id: "text-surface", label: "Texto principal sobre las tarjetas", foreground: "foreground", background: "surface", required: AA_NORMAL_TEXT },
  { id: "primary-text", label: "Texto del botón sobre el acento", foreground: "primaryForeground", background: "primary", required: AA_NORMAL_TEXT },
  { id: "primary-background", label: "Acento sobre el fondo", foreground: "primary", background: "background", required: AA_UI_COMPONENT },
];

export function isHex(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/** Todos los pares que el servidor verificará, con su razón actual. */
export function paletteContrastChecks(palette: EditablePalette): ContrastCheck[] {
  return PAIRS.map((pair) => {
    const a = palette[pair.foreground];
    const b = palette[pair.background];
    const ratio = isHex(a) && isHex(b) ? contrastRatio(a, b) : null;
    return { ...pair, ratio, passes: ratio !== null && ratio >= pair.required };
  });
}

/** `"3.1:1"`; sin `toFixed(2)` para no redondear hacia arriba un 4.496 a «4.50». */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

/** El mensaje exacto de un par que no pasa, p. ej. «Texto principal sobre el fondo: 3.10:1 (necesita 4.5:1)». */
export function describeFailure(check: ContrastCheck): string {
  return check.ratio === null
    ? `${check.label}: falta un color válido.`
    : `${check.label}: ${formatRatio(check.ratio)} (necesita ${check.required}:1).`;
}

/** Los pares en los que interviene un color, para marcarlo en su propia fila. */
export function checksFor(color: PaletteKey, checks: readonly ContrastCheck[]): ContrastCheck[] {
  return checks.filter((check) => check.foreground === color || check.background === color);
}
