import { z } from "zod";
import { AA_NORMAL_TEXT, AA_UI_COMPONENT, contrastRatio, HEX_COLOR_PATTERN } from "../contrast.js";

// Tokens de tema (F2.5). El usuario elige **valores de un conjunto cerrado**, nunca CSS libre:
// los colores son hex de 6 dígitos y todo lo demás son enums. Un hex es un dato, no una regla de
// estilo — no puede cerrar una declaración e inyectar otra, que es justo el riesgo de aceptar CSS.

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, "Usa un color hexadecimal de 6 dígitos, por ejemplo #1d4ed8.")
  .toLowerCase();

/**
 * Paleta mínima para renderizar una página pública completa. Deliberadamente corta: cada color
 * que se agrega es un par de contraste más que hay que garantizar, y un tema con veinte perillas
 * es un tema que el usuario deja mal configurado.
 */
const paletteSchema = z.object({
  background: hexColorSchema,
  surface: hexColorSchema,
  foreground: hexColorSchema,
  mutedForeground: hexColorSchema,
  primary: hexColorSchema,
  primaryForeground: hexColorSchema,
  border: hexColorSchema,
});

/**
 * Familias tipográficas permitidas. Lista blanca por dos razones: evita que alguien inyecte una
 * cadena arbitraria en un `font-family`, y mantiene la promesa de "tipografía clara" sin pedirle
 * fuentes a un tercero desde el navegador del visitante (implicancias de privacidad).
 *
 * Las cuatro primeras usan fuentes del sistema. `executive` y `vibrant` (PP4) son parejas reales
 * —una fuente para títulos y otra para el texto— **alojadas en el propio sitio** (paquetes
 * `@fontsource-variable/*` con licencia OFL, empaquetados por cada app); `editorial` (PL2, ADR-008)
 * es Fraunces en títulos + Inter en texto, la pareja de los temas oscuros. Ver
 * `themeTokensToCssVariables` y `packages/blocks-renderer/src/styles/fonts.css`.
 */
export const FONT_FAMILIES = ["system", "serif", "geometric", "humanist", "executive", "vibrant", "editorial"] as const;

// "Bordes moderados, nada excesivamente redondo" es dirección visual obligatoria (CLAUDE.md), así
// que no existe una opción "pill" para el marco general del tema.
export const RADIUS_SCALES = ["none", "subtle", "moderate"] as const;
export const DENSITY_SCALES = ["compact", "comfortable"] as const;
// "Sombras discretas" — tampoco hay una opción pesada.
export const SHADOW_SCALES = ["none", "subtle"] as const;
/**
 * `glass` (PL5, ADR-008): los botones secundarios son translúcidos sobre el fondo —el patrón de las
 * apps de enlace en bio sobre foto o fondo oscuro—; la acción principal sigue sólida. Su texto es el
 * de la página, y la matriz tema × fondo verifica AA con la capa ya mezclada (`GLASS_ALPHA`).
 *
 * `mono` (PL7): todos los botones de la pila con la misma superficie neutra del tema —también la
 * acción principal, que se distingue solo por alto y halo—. Usa el par superficie/texto que ya se
 * verifica en cada tema.
 */
export const BUTTON_STYLES = ["solid", "outline", "glass", "mono"] as const;

/** Opacidad del tinte de un botón "glass": el color del texto de la página al 12 % sobre el fondo. */
export const GLASS_ALPHA = 0.12;

export const themeTokensSchema = z
  .object({
    palette: paletteSchema,
    fontFamily: z.enum(FONT_FAMILIES),
    radius: z.enum(RADIUS_SCALES),
    density: z.enum(DENSITY_SCALES),
    shadow: z.enum(SHADOW_SCALES),
    buttonStyle: z.enum(BUTTON_STYLES),
  })
  // Sin esto, un tema válido "de forma" podría ser ilegible. El objetivo WCAG 2.2 AA del proyecto
  // no puede depender de que el usuario elija bien: se verifica al guardar, en el servidor.
  .superRefine((tokens, ctx) => {
    const { palette } = tokens;

    const textPairs: Array<[string, string, string]> = [
      ["palette.foreground", palette.foreground, palette.background],
      ["palette.mutedForeground", palette.mutedForeground, palette.background],
      ["palette.foreground", palette.foreground, palette.surface],
      ["palette.primaryForeground", palette.primaryForeground, palette.primary],
    ];

    for (const [path, foreground, background] of textPairs) {
      const ratio = contrastRatio(foreground, background);
      if (ratio < AA_NORMAL_TEXT) {
        ctx.addIssue({
          code: "custom",
          path: path.split("."),
          message: `Contraste insuficiente (${ratio.toFixed(2)}:1). WCAG 2.2 AA exige al menos ${AA_NORMAL_TEXT}:1 para texto.`,
        });
      }
    }

    // El color primario sí es un componente de interfaz (el botón de acción): le basta 3:1, pero
    // tiene que distinguirse del fondo o la página queda inoperable para baja visión.
    //
    // `border` queda fuera a propósito: WCAG 1.4.11 exige 3:1 a los límites *esenciales* de un
    // componente, no a un separador decorativo. Exigírselo obligaría a bordes pesados, que
    // contradicen la dirección visual del proyecto ("bordes moderados, sombras discretas") y al
    // propio design system, cuyo borde es #e2e8f0 sobre blanco por decisión de diseño.
    const uiPairs: Array<[string, string, string]> = [
      ["palette.primary", palette.primary, palette.background],
    ];

    for (const [path, foreground, background] of uiPairs) {
      const ratio = contrastRatio(foreground, background);
      if (ratio < AA_UI_COMPONENT) {
        ctx.addIssue({
          code: "custom",
          path: path.split("."),
          message: `Contraste insuficiente (${ratio.toFixed(2)}:1). WCAG 2.2 AA exige al menos ${AA_UI_COMPONENT}:1 para elementos de interfaz.`,
        });
      }
    }
  });

export type ThemeTokens = z.infer<typeof themeTokensSchema>;
