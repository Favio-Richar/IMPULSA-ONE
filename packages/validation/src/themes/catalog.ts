import type { ThemeTokens } from "./tokens.js";

// Catálogo base de temas (F2.5). Todos respetan la dirección visual obligatoria de CLAUDE.md:
// fondo blanco o muy claro, profesional, bordes moderados, sombras discretas, nada excesivamente
// redondo. No se copia la estética de Linktree/HeyLink/Beacons/Stan: son referencias funcionales.
//
// Cada paleta se eligió calculando el contraste, no a ojo — hay una prueba que vuelve a exigir
// WCAG 2.2 AA sobre este catálogo, de modo que aflojar un color aquí rompe el build.

export interface ThemeCatalogEntry {
  code: string;
  name: string;
  description: string;
  tokens: ThemeTokens;
}

export const THEME_CATALOG: readonly ThemeCatalogEntry[] = [
  {
    code: "claro-profesional",
    name: "Claro profesional",
    description: "Neutro y sobrio. La opción segura para servicios profesionales.",
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
];

export const DEFAULT_THEME_CODE = "claro-profesional";

export function getCatalogTheme(code: string): ThemeCatalogEntry | undefined {
  return THEME_CATALOG.find((theme) => theme.code === code);
}
