import type { ThemeTokens } from "./tokens.js";

// Traduce los tokens de un tema (enums cerrados, F2.5) a propiedades custom de CSS concretas.
// Isomorfo y puro a propósito: hoy lo usa el render público (`apps/web`, F2.7) para pintar cada
// sitio con su propio tema en tiempo de petición (variables inyectadas por sitio, no un tema fijo
// compilado); el constructor visual (F2.9) va a necesitar exactamente el mismo mapeo para que la
// vista previa coincida con lo publicado — un solo lugar, no dos tablas que puedan divergir.
//
// Los valores concretos (radios, sombras, pila tipográfica) no están definidos en ningún otro
// lugar del proyecto: F2.5 solo guarda el nombre del enum. Elegirlos es trabajo de esta función, y
// se mantienen deliberadamente alineados con `packages/ui/src/styles/tokens.css` (mismo tipo de
// sombra "discreta", misma escala de radio "moderada") para que el producto entero —panel interno
// y sitios públicos— se sienta de la misma familia visual aunque el color varíe por tenant.
//
// Sin fuentes pedidas a terceros: las familias clásicas usan fuentes del sistema operativo, y las
// parejas `executive`/`vibrant` (PP4) usan fuentes OFL **alojadas en el propio sitio** (declaradas
// en `packages/blocks-renderer/src/styles/fonts.css`, que cada app empaqueta en sus estáticos). El
// navegador solo descarga una fuente cuando hay texto que la usa, y solo el subconjunto de
// caracteres que aparece (latino para español), con `font-display: swap` para no frenar el LCP.
// Cada pila termina en fuentes del sistema: si la fuente propia no cargó, el texto se ve igual.
const SYSTEM_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_SERIF = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';

const FONT_STACKS: Record<ThemeTokens["fontFamily"], { body: string; heading: string }> = {
  system: { body: SYSTEM_SANS, heading: SYSTEM_SANS },
  serif: { body: SYSTEM_SERIF, heading: SYSTEM_SERIF },
  geometric: {
    body: 'ui-sans-serif, "Century Gothic", Futura, "Segoe UI", system-ui, sans-serif',
    heading: 'ui-sans-serif, "Century Gothic", Futura, "Segoe UI", system-ui, sans-serif',
  },
  humanist: {
    body: 'ui-sans-serif, "Segoe UI", "Noto Sans", Calibri, "Helvetica Neue", Arial, sans-serif',
    heading: 'ui-sans-serif, "Segoe UI", "Noto Sans", Calibri, "Helvetica Neue", Arial, sans-serif',
  },
  // Sobria y formal: serif editorial para los títulos, sans neutra y muy legible para el texto.
  executive: { body: `"Inter Variable", ${SYSTEM_SANS}`, heading: `"Source Serif 4 Variable", ${SYSTEM_SERIF}` },
  // Juvenil: grotesca expresiva para los títulos, sans redondeada para el texto.
  vibrant: { body: `"Manrope Variable", ${SYSTEM_SANS}`, heading: `"Bricolage Grotesque Variable", ${SYSTEM_SANS}` },
};

const RADIUS_VALUES: Record<ThemeTokens["radius"], string> = {
  none: "0px",
  subtle: "0.375rem",
  moderate: "0.75rem",
};

// Mismo par que `--shadow-sm`/`--shadow-md` de packages/ui/src/styles/tokens.css — "discretas",
// nunca la sombra pesada de plantillas genéricas.
const SHADOW_VALUES: Record<ThemeTokens["shadow"], string> = {
  none: "none",
  subtle: "0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.08)",
};

/** Ritmo vertical: separación entre bloques y relleno de sección. */
const DENSITY_VALUES: Record<ThemeTokens["density"], { gap: string; sectionPadding: string }> = {
  compact: { gap: "1rem", sectionPadding: "2rem" },
  comfortable: { gap: "1.5rem", sectionPadding: "3.5rem" },
};

/**
 * Nombres de las propiedades custom que expone esta función. Prefijadas `--site-` y no `--color-`
 * como en `packages/ui`: son dos sistemas de tokens deliberadamente distintos (uno fijo para el
 * panel interno, uno dinámico por tenant para sitios públicos) y no deben poder confundirse ni
 * colisionar si algún día conviven en el mismo árbol de DOM.
 */
export interface ThemeCssVariables {
  "--site-color-background": string;
  "--site-color-surface": string;
  "--site-color-foreground": string;
  "--site-color-muted-foreground": string;
  "--site-color-primary": string;
  "--site-color-primary-foreground": string;
  "--site-color-border": string;
  /** Color de los enlaces de texto: el primario, salvo que un fondo (PP3) lo cambie. */
  "--site-color-link": string;
  /** Copia fija de la paleta del tema: un fondo (PP3) cambia `--site-color-foreground` y compañía
   *  para el texto que va directo sobre él, y las tarjetas vuelven a estos valores. */
  "--site-theme-foreground": string;
  "--site-theme-muted-foreground": string;
  "--site-theme-border": string;
  "--site-font-family": string;
  /** Fuente de los títulos (`h1`–`h4`). Igual a `--site-font-family` salvo en las parejas (PP4). */
  "--site-font-heading": string;
  "--site-radius": string;
  "--site-shadow": string;
  "--site-gap": string;
  "--site-section-padding": string;
}

export function themeTokensToCssVariables(tokens: ThemeTokens): ThemeCssVariables {
  const density = DENSITY_VALUES[tokens.density];

  return {
    "--site-color-background": tokens.palette.background,
    "--site-color-surface": tokens.palette.surface,
    "--site-color-foreground": tokens.palette.foreground,
    "--site-color-muted-foreground": tokens.palette.mutedForeground,
    "--site-color-primary": tokens.palette.primary,
    "--site-color-primary-foreground": tokens.palette.primaryForeground,
    "--site-color-border": tokens.palette.border,
    "--site-color-link": tokens.palette.primary,
    "--site-theme-foreground": tokens.palette.foreground,
    "--site-theme-muted-foreground": tokens.palette.mutedForeground,
    "--site-theme-border": tokens.palette.border,
    "--site-font-family": FONT_STACKS[tokens.fontFamily].body,
    "--site-font-heading": FONT_STACKS[tokens.fontFamily].heading,
    "--site-radius": RADIUS_VALUES[tokens.radius],
    "--site-shadow": SHADOW_VALUES[tokens.shadow],
    "--site-gap": density.gap,
    "--site-section-padding": density.sectionPadding,
  };
}
