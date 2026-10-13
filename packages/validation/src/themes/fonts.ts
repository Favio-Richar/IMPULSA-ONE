import type { ThemeTokens } from "./tokens.js";

// Cómo se presentan las tipografías del catálogo cerrado al elegirlas: agrupadas por estilo, con una línea que las describe. Es
// solo presentación (el enum y las pilas viven en `tokens.ts` y `css-variables.ts`); una prueba verifica que no falte ninguna.

export type FontFamily = ThemeTokens["fontFamily"];

export const FONT_STYLE_GROUPS = [
  { id: "dispositivo", label: "Del dispositivo", description: "Las fuentes del teléfono o la computadora: no descargan nada." },
  { id: "serif-editorial", label: "Serif editorial", description: "Títulos con carácter, de revista y de libro." },
  { id: "sans-moderna", label: "Sans moderna", description: "Limpias y actuales, una sola familia." },
  { id: "display", label: "Display expresiva", description: "Títulos con personalidad; el texto sigue siendo sobrio." },
] as const;

export type FontStyleGroup = (typeof FONT_STYLE_GROUPS)[number]["id"];

export const FONT_FAMILY_META: Record<FontFamily, { label: string; description: string; group: FontStyleGroup }> = {
  system: { label: "Sistema", description: "La sans del dispositivo: la más rápida.", group: "dispositivo" },
  serif: { label: "Serif del sistema", description: "Clásica y formal.", group: "dispositivo" },
  geometric: { label: "Geométrica", description: "Formas redondas y limpias.", group: "dispositivo" },
  humanist: { label: "Humanista", description: "Cálida y muy legible.", group: "dispositivo" },
  executive: { label: "Ejecutiva", description: "Títulos Source Serif, texto en Inter.", group: "serif-editorial" },
  editorial: { label: "Editorial", description: "Títulos Fraunces, texto en Inter.", group: "serif-editorial" },
  playfair: { label: "Playfair", description: "Títulos elegantes de alto contraste.", group: "serif-editorial" },
  lora: { label: "Lora", description: "Serif caligráfica y cálida, también en el texto.", group: "serif-editorial" },
  cormorant: { label: "Cormorant", description: "Títulos finos y refinados.", group: "serif-editorial" },
  dmsans: { label: "DM Sans", description: "Geométrica de contraste bajo, muy clara.", group: "sans-moderna" },
  jakarta: { label: "Jakarta", description: "Moderna y amable, ideal para marcas.", group: "sans-moderna" },
  outfit: { label: "Outfit", description: "Geométrica y redonda, con aire.", group: "sans-moderna" },
  montserrat: { label: "Montserrat", description: "Urbana y firme, de títulos anchos.", group: "sans-moderna" },
  vibrant: { label: "Vibrante", description: "Títulos Bricolage, texto Manrope.", group: "display" },
  grotesk: { label: "Space Grotesk", description: "Grotesca con aire técnico.", group: "display" },
  sora: { label: "Sora", description: "Futurista y amplia.", group: "display" },
  syne: { label: "Syne", description: "Expresiva y de formas inusuales.", group: "display" },
  caveat: { label: "Caveat", description: "Manuscrita, para un toque personal.", group: "display" },
};
