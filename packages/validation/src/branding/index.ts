import { z } from "zod";
import { AA_NORMAL_TEXT, contrastRatio, HEX_COLOR_PATTERN } from "../contrast.js";
import { sanitizeSvg } from "./svg.js";

export { sanitizeSvg, type SvgSanitizeResult } from "./svg.js";
/** Nombre histórico: el saneador ahora reconstruye el SVG desde una lista de permitidos. */
export const validateAndSanitizeSvg = sanitizeSvg;

/**
 * Marca por defecto: reproduce lo que el producto ya mostraba antes de F9.1. No inventa dominios ni
 * remitentes: los enlaces legales son las páginas internas que ya existen (`/privacidad`, `/terminos`),
 * el soporte y el correo remitente quedan sin definir hasta que el propietario los configure.
 */
export const DEFAULT_PLATFORM_BRANDING = {
  name: "Impulza One",
  logoLightUrl: null as string | null,
  logoDarkUrl: null as string | null,
  faviconUrl: null as string | null,
  primaryColor: "#0f6f6b",
  secondaryColor: "#0b5450",
  senderName: "Impulza One",
  senderEmail: null as string | null,
  supportUrl: null as string | null,
  privacyUrl: "/privacidad" as string | null,
  termsUrl: "/terminos" as string | null,
  footerText: "Portal biográfico, reservas, catálogo, mini-CRM, formularios, QR y analítica en un solo sistema." as string | null,
};

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, "Debe ser un color hexadecimal válido de 6 caracteres (ej. #0f6f6b).");

function isDevelopment(): boolean {
  // Este paquete corre en el navegador y en Node, y no declara tipos de Node: se lee `process` sin ellos.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.NODE_ENV !== "production";
}

/**
 * URL absoluta segura para un recurso (logo, favicon): `https://` siempre; `http://` solo para
 * `localhost` / `127.0.0.1` **exactos** y fuera de producción. Se compara el hostname ya interpretado
 * (`new URL`), nunca el comienzo del texto: `http://localhost.evil.com` no es localhost.
 */
export function isSafeAssetUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && isDevelopment() && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

/** Enlace para el pie y la ayuda: URL absoluta segura o ruta interna (`/privacidad`, nunca `//host`). */
export function isSafeLinkUrl(value: string): boolean {
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.includes("\\")) return false;
    // Sin espacios ni caracteres de control (se compara por código: el lint prohíbe controles en regex).
    return ![...value].some((char) => char.charCodeAt(0) <= 0x20 || char.charCodeAt(0) === 0x7f);
  }
  return isSafeAssetUrl(value);
}

const emptyToNull = (value: unknown): unknown => (typeof value === "string" && value.trim() === "" ? null : value);

const assetUrlSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(2048)
    .refine(isSafeAssetUrl, { message: "El enlace debe comenzar con https://." })
    .nullable()
    .optional(),
);

const linkUrlSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(2048)
    .refine(isSafeLinkUrl, { message: "Usa un enlace https:// o una ruta interna que empiece con /." })
    .nullable()
    .optional(),
);

/** Compatibilidad: el esquema anterior se llamaba así y solo aceptaba absolutas. */
export const httpsUrlSchema = assetUrlSchema;

export const publicPlatformBrandingSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(100),
  logoLightUrl: assetUrlSchema,
  logoDarkUrl: assetUrlSchema,
  faviconUrl: assetUrlSchema,
  primaryColor: hexColorSchema,
  secondaryColor: hexColorSchema,
  supportUrl: linkUrlSchema,
  privacyUrl: linkUrlSchema,
  termsUrl: linkUrlSchema,
  footerText: z.string().trim().max(500).nullable().optional(),
});

export type PublicPlatformBrandingDto = z.infer<typeof publicPlatformBrandingSchema>;

export const platformBrandingSchema = publicPlatformBrandingSchema.extend({
  id: z.string().uuid(),
  senderName: z.string().trim().min(1).max(100),
  senderEmail: z.string().trim().email().nullable(),
  updatedAt: z.string(),
  updatedByAdminId: z.string().uuid().nullable().optional(),
});

export type PlatformBrandingDto = z.infer<typeof platformBrandingSchema>;

export const updatePlatformBrandingSchema = z
  .object({
    name: z.string().trim().min(1, "El nombre de la plataforma es obligatorio.").max(100),
    logoLightUrl: assetUrlSchema,
    logoDarkUrl: assetUrlSchema,
    faviconUrl: assetUrlSchema,
    primaryColor: hexColorSchema,
    secondaryColor: hexColorSchema,
    senderName: z.string().trim().min(1, "El nombre del remitente es obligatorio.").max(100),
    senderEmail: z.preprocess(
      emptyToNull,
      z.string().trim().email("El correo del remitente debe ser una dirección válida.").nullable().optional(),
    ),
    supportUrl: linkUrlSchema,
    privacyUrl: linkUrlSchema,
    termsUrl: linkUrlSchema,
    footerText: z.string().trim().max(500, "El texto de pie no puede exceder 500 caracteres.").nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // F9.1 criterio 3: el servidor rechaza colores de marca con contraste menor a 4.5:1 sobre el
    // fondo claro donde se usan (botones con texto blanco y texto de marca sobre blanco).
    for (const field of ["primaryColor", "secondaryColor"] as const) {
      const ratio = contrastRatio(data[field], "#ffffff");
      if (ratio < AA_NORMAL_TEXT) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `Contraste insuficiente (${ratio.toFixed(2)}:1). WCAG 2.2 AA exige al menos ${AA_NORMAL_TEXT}:1 sobre fondo claro (#ffffff).`,
        });
      }
    }
  });

export type UpdatePlatformBrandingDto = z.infer<typeof updatePlatformBrandingSchema>;

/**
 * Variables CSS que aplican el color de marca a la interfaz (`--color-primary` y su hover). Devuelve
 * `null` si coinciden con los valores por defecto (no hay nada que sobrescribir) o si algún valor no
 * es un hexadecimal válido: lo que sale de la base de datos **nunca** se interpola en CSS sin validar.
 */
export function brandCssVariables(primaryColor: string, secondaryColor: string): string | null {
  const primary = hexColorSchema.safeParse(primaryColor);
  const secondary = hexColorSchema.safeParse(secondaryColor);
  if (!primary.success || !secondary.success) return null;
  if (
    primary.data.toLowerCase() === DEFAULT_PLATFORM_BRANDING.primaryColor &&
    secondary.data.toLowerCase() === DEFAULT_PLATFORM_BRANDING.secondaryColor
  ) {
    return null;
  }
  return `:root{--color-primary:${primary.data};--color-primary-hover:${secondary.data};}`;
}

export const BRANDING_TARGETS = ["logo_light", "logo_dark", "favicon"] as const;
export type BrandingTarget = (typeof BRANDING_TARGETS)[number];

export const BRANDING_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export type BrandingMimeType = (typeof BRANDING_MIME_TYPES)[number];

export const MAX_BRANDING_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_BRANDING_FAVICON_BYTES = 512 * 1024; // 512 KB
/** Lado mínimo y máximo (px) de un logo o favicon de mapa de bits. */
export const MIN_BRANDING_LOGO_DIMENSION = 32;
export const MIN_BRANDING_FAVICON_DIMENSION = 16;
export const MAX_BRANDING_DIMENSION = 4096;

export const uploadBrandingAssetSchema = z.object({
  target: z.enum(BRANDING_TARGETS),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(BRANDING_MIME_TYPES),
  sizeBytes: z.number().int().positive(),
  base64Data: z.string().min(1, "El contenido del archivo es obligatorio."),
});

export type UploadBrandingAssetDto = z.infer<typeof uploadBrandingAssetSchema>;

export {
  brandProfileSchema,
  updateBrandProfileSchema,
  resolvedBrandSchema,
  type BrandProfileDto,
  type UpdateBrandProfileDto,
  type ResolvedBrandDto,
} from "./brand-profile.js";
