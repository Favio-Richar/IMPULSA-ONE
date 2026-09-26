import { z } from "zod";
import { AA_NORMAL_TEXT, contrastRatio } from "../contrast.js";
import { safeUrlSchema } from "../blocks/primitives.js";
import { hexColorSchema, type ThemeTokens } from "../themes/tokens.js";

// Fondo premium de la página (PP3, `docs/BACKLOG_PAGINA_PREMIUM.md`). Igual que el tema (F2.5), el
// usuario elige entre valores cerrados — un color hex, un código del catálogo de degradados, una
// imagen propia o un video de la biblioteca curada — y nunca CSS libre.
//
// **Legibilidad garantizada.** El texto que va directo sobre el fondo (títulos, biografía,
// navegación) cambia a una paleta clara u oscura cuando la del tema no alcanza AA. Sobre una imagen
// o un video, la capa de oscurecido o aclarado tiene que alcanzar AA **en el peor punto de la
// imagen** (sus tonos extremos, que calcula el worker al procesarla): el servidor rechaza una
// intensidad que no llega. Las tarjetas (enlaces, servicios, formularios) conservan los colores del
// tema, que ya se verificaron en F2.5.

/** Paleta de texto sobre el fondo: la del tema, o una fija clara u oscura. */
export const BACKGROUND_TEXT_PALETTES = ["theme", "light", "dark"] as const;
export type BackgroundTextPalette = (typeof BACKGROUND_TEXT_PALETTES)[number];

/** Texto claro (para fondos oscuros) y texto oscuro (para fondos claros). */
export const ON_BACKGROUND_TEXT: Record<Exclude<BackgroundTextPalette, "theme">, { foreground: string; mutedForeground: string }> = {
  light: { foreground: "#ffffff", mutedForeground: "#e2e8f0" },
  dark: { foreground: "#0f172a", mutedForeground: "#334155" },
};

// --- Degradados curados --------------------------------------------------------------------

export interface BackgroundGradient {
  code: string;
  name: string;
  /** Dos colores, de arriba a la izquierda hacia abajo a la derecha. */
  stops: readonly [string, string];
  /** Paleta de texto que se lee sobre **todo** el degradado (una prueba lo verifica). */
  text: Exclude<BackgroundTextPalette, "theme">;
}

export const BACKGROUND_GRADIENTS = [
  { code: "amanecer", name: "Amanecer", stops: ["#fdf2e9", "#fce7f3"], text: "dark" },
  { code: "brisa", name: "Brisa", stops: ["#ecfeff", "#e0e7ff"], text: "dark" },
  { code: "salvia", name: "Salvia", stops: ["#f0fdf4", "#ecfccb"], text: "dark" },
  { code: "arena", name: "Arena", stops: ["#faf7f2", "#efe6d8"], text: "dark" },
  { code: "medianoche", name: "Medianoche", stops: ["#0f172a", "#1e3a8a"], text: "light" },
  { code: "bosque", name: "Bosque", stops: ["#052e2b", "#14532d"], text: "light" },
  { code: "ciruela", name: "Ciruela", stops: ["#2e1065", "#831843"], text: "light" },
  { code: "grafito", name: "Grafito", stops: ["#111827", "#374151"], text: "light" },
] as const satisfies readonly BackgroundGradient[];

export type BackgroundGradientCode = (typeof BACKGROUND_GRADIENTS)[number]["code"];
const GRADIENT_CODES = BACKGROUND_GRADIENTS.map((gradient) => gradient.code) as [BackgroundGradientCode, ...BackgroundGradientCode[]];

export function getBackgroundGradient(code: string): BackgroundGradient | undefined {
  return BACKGROUND_GRADIENTS.find((gradient) => gradient.code === code);
}

/** CSS del degradado. Sale solo del catálogo: el valor guardado es un código, nunca CSS. */
export function gradientCss(gradient: BackgroundGradient): string {
  return `linear-gradient(160deg, ${gradient.stops[0]} 0%, ${gradient.stops[1]} 100%)`;
}

// --- Capa de legibilidad ---------------------------------------------------------------------

export const OVERLAY_TONES = ["dark", "light"] as const;
export const OVERLAY_STRENGTHS = ["soft", "medium", "strong"] as const;
export type OverlayTone = (typeof OVERLAY_TONES)[number];
export type OverlayStrength = (typeof OVERLAY_STRENGTHS)[number];

export const overlaySchema = z.object({
  tone: z.enum(OVERLAY_TONES),
  strength: z.enum(OVERLAY_STRENGTHS),
});
export type BackgroundOverlay = z.infer<typeof overlaySchema>;

/** Color de cada capa. Oscura: el mismo azul casi negro del texto oscuro, más cálido que el negro puro. */
export const OVERLAY_COLORS: Record<OverlayTone, string> = { dark: "#0f172a", light: "#ffffff" };

/**
 * Opacidad de cada intensidad. "Fuerte" alcanza AA **sobre cualquier imagen** (blanco puro bajo la
 * capa oscura, negro puro bajo la clara; una prueba lo verifica), así que siempre hay al menos una
 * opción válida. Las más suaves solo se aceptan si la imagen concreta lo permite.
 */
export const OVERLAY_ALPHA: Record<OverlayTone, Record<OverlayStrength, number>> = {
  dark: { soft: 0.3, medium: 0.5, strong: 0.7 },
  light: { soft: 0.4, medium: 0.6, strong: 0.8 },
};

/** Sobre una capa oscura el texto es claro, y al revés. */
export function overlayTextPalette(tone: OverlayTone): Exclude<BackgroundTextPalette, "theme"> {
  return tone === "dark" ? "light" : "dark";
}

/**
 * Tonos extremos de una imagen o del póster de un video: el color más oscuro y el más claro de su
 * versión reducida (percentiles 2 y 98, ver `computeImageTones` en `@impulza/storage`). Es lo que
 * permite saber si el texto se lee sobre **toda** la imagen y no solo en promedio.
 */
export const imageTonesSchema = z.object({ darkest: hexColorSchema, lightest: hexColorSchema });
export type ImageTones = z.infer<typeof imageTonesSchema>;

/** Sin datos (una imagen subida antes de PP3), se asume el peor caso: de negro puro a blanco puro. */
export const UNKNOWN_IMAGE_TONES: ImageTones = { darkest: "#000000", lightest: "#ffffff" };

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}

/** Color resultante de pintar `overlay` con opacidad `alpha` sobre `base` (mezcla normal de CSS). */
export function blendHex(base: string, overlay: string, alpha: number): string {
  const [br, bg, bb] = hexToRgb(base);
  const [or, og, ob] = hexToRgb(overlay);
  const mix = (b: number, o: number) => Math.round(o * alpha + b * (1 - alpha)).toString(16).padStart(2, "0");
  return `#${mix(br, or)}${mix(bg, og)}${mix(bb, ob)}`;
}

function paletteReadableOn(palette: { foreground: string; mutedForeground: string }, background: string): boolean {
  return contrastRatio(palette.foreground, background) >= AA_NORMAL_TEXT && contrastRatio(palette.mutedForeground, background) >= AA_NORMAL_TEXT;
}

/**
 * ¿El texto se lee sobre la imagen con esta capa? Se evalúa en el punto más desfavorable: bajo una
 * capa oscura (texto claro) importa la zona más clara de la imagen; bajo una clara, la más oscura.
 */
export function isOverlayLegible(tones: ImageTones | null, overlay: BackgroundOverlay): boolean {
  const known = tones ?? UNKNOWN_IMAGE_TONES;
  const worst = overlay.tone === "dark" ? known.lightest : known.darkest;
  const composite = blendHex(worst, OVERLAY_COLORS[overlay.tone], OVERLAY_ALPHA[overlay.tone][overlay.strength]);
  return paletteReadableOn(ON_BACKGROUND_TEXT[overlayTextPalette(overlay.tone)], composite);
}

/** Las intensidades que se leen bien sobre esta imagen, para ofrecer solo esas en el panel. */
export function legibleStrengths(tones: ImageTones | null, tone: OverlayTone): OverlayStrength[] {
  return OVERLAY_STRENGTHS.filter((strength) => isOverlayLegible(tones, { tone, strength }));
}

/** Paleta de texto para un fondo de color: la del tema si alcanza, si no la clara o la oscura. */
export function colorTextPalette(color: string, theme: ThemeTokens | null): BackgroundTextPalette | null {
  if (theme && paletteReadableOn(theme.palette, color)) {
    return "theme";
  }
  if (paletteReadableOn(ON_BACKGROUND_TEXT.dark, color)) {
    return "dark";
  }
  if (paletteReadableOn(ON_BACKGROUND_TEXT.light, color)) {
    return "light";
  }
  return null;
}

// --- Videos curados -------------------------------------------------------------------------

export interface BackgroundVideo {
  code: string;
  name: string;
  /** Claves en el bucket público de medios (`curated/...`), no URLs: la API arma la URL. */
  posterKey: string;
  videoKey: string;
  tones: ImageTones;
  /** Dónde se obtuvo y con qué licencia comercial: se revisa antes de sumar un video. */
  license: string;
}

/**
 * Biblioteca curada de videos de fondo (PP3). **Vacía a propósito hasta que Favio apruebe el
 * contenido** (criterio de aceptación de PP3): cada video necesita licencia comercial verificada.
 * Mientras esté vacía, el panel no ofrece la opción de video y la API rechaza cualquier código.
 */
export const BACKGROUND_VIDEOS: readonly BackgroundVideo[] = [];

export function getBackgroundVideo(code: string): BackgroundVideo | undefined {
  return BACKGROUND_VIDEOS.find((video) => video.code === code);
}

// --- Esquemas ---------------------------------------------------------------------------------

export const siteBackgroundSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("color"),
    color: hexColorSchema.refine((color) => colorTextPalette(color, null) !== null, {
      message: "Con ese color ningún texto alcanza el contraste mínimo. Elige uno más claro o más oscuro.",
    }),
  }),
  z.object({ kind: z.literal("gradient"), gradient: z.enum(GRADIENT_CODES) }),
  z.object({ kind: z.literal("image"), image: z.object({ url: safeUrlSchema }), overlay: overlaySchema }),
  z.object({
    kind: z.literal("video"),
    video: z.string().refine((code) => getBackgroundVideo(code) !== undefined, { message: "Ese video no está disponible." }),
    overlay: overlaySchema,
  }),
  // Video propio (PP6): el cliente manda la URL del video de su biblioteca; el servidor verifica que
  // sea suyo y esté listo, y guarda las URLs canónicas del video y de su póster.
  z.object({
    kind: z.literal("own_video"),
    video: z.object({ src: safeUrlSchema, posterUrl: safeUrlSchema.optional() }),
    overlay: overlaySchema,
  }),
]);
export type SiteBackground = z.infer<typeof siteBackgroundSchema>;

/** Lo que necesita el render (público y vista previa): el fondo guardado ya resuelto. */
export const resolvedSiteBackgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("color"), color: hexColorSchema, text: z.enum(BACKGROUND_TEXT_PALETTES) }),
  z.object({ kind: z.literal("gradient"), gradient: z.enum(GRADIENT_CODES), text: z.enum(BACKGROUND_TEXT_PALETTES) }),
  z.object({ kind: z.literal("image"), image: z.object({ url: z.string() }), overlay: overlaySchema, text: z.enum(BACKGROUND_TEXT_PALETTES) }),
  z.object({
    kind: z.literal("video"),
    video: z.object({ posterUrl: z.string(), src: z.string() }),
    overlay: overlaySchema,
    text: z.enum(BACKGROUND_TEXT_PALETTES),
  }),
]);
export type ResolvedSiteBackground = z.infer<typeof resolvedSiteBackgroundSchema>;

/**
 * Resuelve un fondo guardado para el render. `videoUrl` arma la URL pública de una clave del
 * bucket (solo la API la conoce). Devuelve `null` si el fondo guardado ya no es válido (un video que
 * salió de la biblioteca, un degradado retirado): la página cae al fondo del tema, nunca se rompe.
 */
export function resolveSiteBackground(
  stored: unknown,
  theme: ThemeTokens,
  videoUrl: (key: string) => string,
): ResolvedSiteBackground | null {
  const parsed = siteBackgroundSchema.safeParse(stored);
  if (!parsed.success) {
    return null;
  }
  const background = parsed.data;
  switch (background.kind) {
    case "color": {
      const text = colorTextPalette(background.color, theme);
      return text ? { kind: "color", color: background.color, text } : null;
    }
    case "gradient":
      return { kind: "gradient", gradient: background.gradient, text: getBackgroundGradient(background.gradient)!.text };
    case "image":
      return { kind: "image", image: background.image, overlay: background.overlay, text: overlayTextPalette(background.overlay.tone) };
    case "video": {
      const video = getBackgroundVideo(background.video)!;
      return {
        kind: "video",
        video: { posterUrl: videoUrl(video.posterKey), src: videoUrl(video.videoKey) },
        overlay: background.overlay,
        text: overlayTextPalette(background.overlay.tone),
      };
    }
    case "own_video": {
      // Sin póster no se guarda nunca (lo completa el servidor); si faltara, el fondo del tema.
      if (!background.video.posterUrl) {
        return null;
      }
      // Para el render es el mismo video de fondo que uno curado: póster primero, video después.
      return {
        kind: "video",
        video: { posterUrl: background.video.posterUrl, src: background.video.src },
        overlay: background.overlay,
        text: overlayTextPalette(background.overlay.tone),
      };
    }
  }
}

/**
 * Variables CSS que cambian con el fondo: solo el texto que va directo sobre él y el color de los
 * enlaces de texto (el primario del tema puede no leerse sobre una foto oscura). Las tarjetas
 * vuelven a la paleta del tema con `--site-theme-*` (ver `SURFACE_SCOPE` en blocks-renderer).
 */
export function backgroundTextCssVariables(text: BackgroundTextPalette): Record<string, string> {
  if (text === "theme") {
    return {};
  }
  const palette = ON_BACKGROUND_TEXT[text];
  return {
    "--site-color-foreground": palette.foreground,
    "--site-color-muted-foreground": palette.mutedForeground,
    "--site-color-link": palette.foreground,
    "--site-color-border": text === "light" ? "rgb(255 255 255 / 0.25)" : "rgb(15 23 42 / 0.15)",
  };
}

/** Color de la capa de legibilidad, como `rgb()` con opacidad, listo para `background-color`. */
export function overlayCss(overlay: BackgroundOverlay): string {
  const [r, g, b] = hexToRgb(OVERLAY_COLORS[overlay.tone]);
  return `rgb(${r} ${g} ${b} / ${OVERLAY_ALPHA[overlay.tone][overlay.strength]})`;
}
