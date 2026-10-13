import { FONT_FAMILIES, FONT_FAMILY_META, FONT_STYLE_GROUPS, type FontFamily } from "@impulza/validation";

// Opciones de tipografía del editor de temas, agrupadas por estilo. El catálogo cerrado y su presentación viven en
// `@impulza/validation` (`FONT_FAMILIES`, `FONT_FAMILY_META`, `FONT_STYLE_GROUPS`): acá solo se arma la lista para el selector.

export type { FontFamily };

export const FONT_GROUPS: ReadonlyArray<{ id: string; label: string; description: string }> = FONT_STYLE_GROUPS;

export const FONT_FAMILY_OPTIONS: ReadonlyArray<{ value: FontFamily; label: string; description: string; group: string }> = FONT_FAMILIES.map((value) => ({
  value,
  ...FONT_FAMILY_META[value],
}));
