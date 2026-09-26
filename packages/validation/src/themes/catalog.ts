import type { ThemeTokens } from "./tokens.js";

// Catálogo base de temas (F2.5). Todos respetan la dirección visual obligatoria de CLAUDE.md:
// fondo blanco o muy claro, profesional, bordes moderados, sombras discretas, nada excesivamente
// redondo. No se copia la estética de Linktree/HeyLink/Beacons/Stan: son referencias funcionales.
//
// Cada paleta se eligió calculando el contraste, no a ojo — hay una prueba que vuelve a exigir
// WCAG 2.2 AA sobre este catálogo, de modo que aflojar un color aquí rompe el build.

/**
 * Líneas del catálogo (PP4). `clasico` son los temas de F2.5; `ejecutivo` (sobrio y formal) y
 * `vibrante` (juvenil y con más color) traen pareja tipográfica propia. El panel las agrupa así.
 */
export const THEME_FAMILIES = ["ejecutivo", "vibrante", "clasico"] as const;
export type ThemeFamily = (typeof THEME_FAMILIES)[number];

export interface ThemeCatalogEntry {
  code: string;
  name: string;
  description: string;
  family: ThemeFamily;
  tokens: ThemeTokens;
}

export const THEME_CATALOG: readonly ThemeCatalogEntry[] = [
  {
    code: "claro-profesional",
    name: "Claro profesional",
    description: "Neutro y sobrio. La opción segura para servicios profesionales.",
    family: "clasico",
    tokens: {
      palette: {
        background: "#ffffff",
        surface: "#f8fafc",
        foreground: "#0f172a",
        mutedForeground: "#475569",
        primary: "#4338ca",
        primaryForeground: "#ffffff",
        border: "#e2e8f0",
      },
      fontFamily: "system",
      radius: "moderate",
      density: "comfortable",
      shadow: "subtle",
      buttonStyle: "solid",
    },
  },
  {
    code: "editorial",
    name: "Editorial",
    description: "Cálido y con aire de publicación. Para portafolios y contenido.",
    family: "clasico",
    tokens: {
      palette: {
        background: "#fdfcfa",
        surface: "#f5f2ed",
        foreground: "#1c1917",
        mutedForeground: "#57534e",
        primary: "#7c2d12",
        primaryForeground: "#ffffff",
        border: "#e7e5e4",
      },
      fontFamily: "serif",
      radius: "subtle",
      density: "comfortable",
      shadow: "none",
      buttonStyle: "outline",
    },
  },
  {
    code: "natural",
    name: "Natural",
    description: "Verde sereno. Para salud, bienestar y oficios con cara humana.",
    family: "clasico",
    tokens: {
      palette: {
        background: "#fbfdfb",
        surface: "#f0f5f1",
        foreground: "#14241a",
        mutedForeground: "#4b5d52",
        primary: "#166534",
        primaryForeground: "#ffffff",
        border: "#dde7e0",
      },
      fontFamily: "humanist",
      radius: "moderate",
      density: "comfortable",
      shadow: "subtle",
      buttonStyle: "solid",
    },
  },
  {
    code: "oceano",
    name: "Océano",
    description: "Azul profundo y limpio. Para técnica, consultoría y educación.",
    family: "clasico",
    tokens: {
      palette: {
        background: "#ffffff",
        surface: "#f0f7fa",
        foreground: "#0c1b22",
        mutedForeground: "#456470",
        primary: "#0e6f84",
        primaryForeground: "#ffffff",
        border: "#dbe9ee",
      },
      fontFamily: "geometric",
      radius: "moderate",
      density: "compact",
      shadow: "subtle",
      buttonStyle: "solid",
    },
  },
  {
    code: "carbon",
    name: "Carbón",
    description: "Monocromo de alto contraste. Para marcas que prefieren no usar color.",
    family: "clasico",
    tokens: {
      palette: {
        background: "#fafafa",
        surface: "#f4f4f5",
        foreground: "#18181b",
        mutedForeground: "#52525b",
        primary: "#27272a",
        primaryForeground: "#ffffff",
        border: "#e4e4e7",
      },
      fontFamily: "geometric",
      radius: "none",
      density: "compact",
      shadow: "none",
      buttonStyle: "solid",
    },
  },
  // --- Ejecutivo (PP4): sobrio y formal. Serif para los títulos, bordes contenidos, poco color.
  {
    code: "ejecutivo-marino",
    name: "Marino",
    description: "Azul marino y blanco. Para abogados, consultoras y finanzas.",
    family: "ejecutivo",
    tokens: {
      palette: {
        background: "#ffffff",
        surface: "#f4f6f9",
        foreground: "#0b1f33",
        mutedForeground: "#4a5a6a",
        primary: "#0b3d6b",
        primaryForeground: "#ffffff",
        border: "#dfe5ec",
      },
      fontFamily: "executive",
      radius: "subtle",
      density: "comfortable",
      shadow: "subtle",
      buttonStyle: "solid",
    },
  },
  {
    code: "ejecutivo-grafito",
    name: "Grafito",
    description: "Grafito con detalle dorado. Para inmobiliarias, arquitectura y marcas de lujo.",
    family: "ejecutivo",
    tokens: {
      palette: {
        background: "#fcfcfb",
        surface: "#f3f2ef",
        foreground: "#1a1a1a",
        mutedForeground: "#55524c",
        primary: "#7a5c12",
        primaryForeground: "#ffffff",
        border: "#e4e2dc",
      },
      fontFamily: "executive",
      radius: "none",
      density: "comfortable",
      shadow: "none",
      buttonStyle: "outline",
    },
  },
  {
    code: "ejecutivo-borgona",
    name: "Borgoña",
    description: "Borgoña sobre marfil. Para salud, docencia y servicios de confianza.",
    family: "ejecutivo",
    tokens: {
      palette: {
        background: "#fffdfb",
        surface: "#f7f1ee",
        foreground: "#221416",
        mutedForeground: "#5e4a4d",
        primary: "#7a1f2b",
        primaryForeground: "#ffffff",
        border: "#eaded9",
      },
      fontFamily: "executive",
      radius: "subtle",
      density: "comfortable",
      shadow: "subtle",
      buttonStyle: "solid",
    },
  },
  // --- Vibrante (PP4): juvenil y con más color, sin salirse de fondos claros ni de bordes
  // moderados (CLAUDE.md). El color vive en el fondo teñido, las tarjetas y el botón.
  {
    code: "vibrante-coral",
    name: "Coral",
    description: "Coral cálido. Para gastronomía, belleza y creadores de contenido.",
    family: "vibrante",
    tokens: {
      palette: {
        background: "#fff8f4",
        surface: "#ffede3",
        foreground: "#2a1410",
        mutedForeground: "#6b4a40",
        primary: "#c2410c",
        primaryForeground: "#ffffff",
        border: "#f6d9ca",
      },
      fontFamily: "vibrant",
      radius: "moderate",
      density: "comfortable",
      shadow: "subtle",
      buttonStyle: "solid",
    },
  },
  {
    code: "vibrante-violeta",
    name: "Violeta",
    description: "Violeta eléctrico. Para música, eventos, tecnología y marcas jóvenes.",
    family: "vibrante",
    tokens: {
      palette: {
        background: "#fbf9ff",
        surface: "#f1ebff",
        foreground: "#1d1433",
        mutedForeground: "#574d70",
        primary: "#6d28d9",
        primaryForeground: "#ffffff",
        border: "#e2d9f7",
      },
      fontFamily: "vibrant",
      radius: "moderate",
      density: "comfortable",
      shadow: "subtle",
      buttonStyle: "solid",
    },
  },
  {
    code: "vibrante-turquesa",
    name: "Turquesa",
    description: "Turquesa fresco. Para deporte, bienestar, viajes y cursos.",
    family: "vibrante",
    tokens: {
      palette: {
        background: "#f5fffc",
        surface: "#e3f8f1",
        foreground: "#0e2622",
        mutedForeground: "#45625b",
        primary: "#0f766e",
        primaryForeground: "#ffffff",
        border: "#cdeee3",
      },
      fontFamily: "vibrant",
      radius: "moderate",
      density: "compact",
      shadow: "subtle",
      buttonStyle: "solid",
    },
  },
];

export const DEFAULT_THEME_CODE = "claro-profesional";

export function getCatalogTheme(code: string): ThemeCatalogEntry | undefined {
  return THEME_CATALOG.find((theme) => theme.code === code);
}
