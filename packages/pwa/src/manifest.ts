/** Manifiesto de la app instalable (F10.5). Forma mínima y cerrada: solo lo que los navegadores exigen para ofrecer la instalación. */

export interface WebAppManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  lang: "es";
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: "image/png"; purpose?: "any" | "maskable" }>;
}

/** Íconos que cada app sirve en `/icons/` (un cuadrado redondeado, uno de 512 y uno «maskable» con zona segura). */
export const MANIFEST_ICONS: WebAppManifest["icons"] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Un color válido o el de reserva: el manifiesto nunca lleva un valor que el navegador pueda rechazar. */
export function manifestColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
}

/** Nombre corto: el que se ve bajo el ícono (los sistemas lo recortan alrededor de 12 caracteres). */
export function shortName(name: string): string {
  const clean = name.trim();
  if (clean.length <= 12) return clean;
  const firstWord = clean.split(/\s+/)[0] ?? clean;
  return firstWord.length >= 3 && firstWord.length <= 12 ? firstWord : `${clean.slice(0, 11).trimEnd()}…`;
}

export function buildManifest(input: {
  name: string;
  description: string;
  startUrl: string;
  scope: string;
  themeColor?: unknown;
  backgroundColor?: unknown;
}): WebAppManifest {
  return {
    name: input.name,
    short_name: shortName(input.name),
    description: input.description,
    start_url: input.startUrl,
    scope: input.scope,
    display: "standalone",
    lang: "es",
    background_color: manifestColor(input.backgroundColor, "#ffffff"),
    theme_color: manifestColor(input.themeColor, "#0f766e"),
    icons: MANIFEST_ICONS,
  };
}
