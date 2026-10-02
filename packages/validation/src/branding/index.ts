import { z } from "zod";
import { AA_NORMAL_TEXT, contrastRatio, HEX_COLOR_PATTERN } from "../contrast.js";

export const DEFAULT_PLATFORM_BRANDING = {
  name: "Impulza One",
  logoLightUrl: null as string | null,
  logoDarkUrl: null as string | null,
  faviconUrl: null as string | null,
  primaryColor: "#0f6f6b",
  secondaryColor: "#0b5450",
  senderName: "Impulza One",
  senderEmail: "notificaciones@impulza.app",
  supportUrl: "https://impulza.app/soporte",
  privacyUrl: "https://impulza.app/privacidad",
  termsUrl: "https://impulza.app/terminos",
  footerText: "Portal biográfico, reservas, catálogo, mini-CRM, formularios, QR y analítica en un solo sistema.",
} as const;

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, "Debe ser un color hexadecimal válido de 6 caracteres (ej. #0f6f6b).");

export const httpsUrlSchema = z
  .string()
  .trim()
  .refine(
    (url) =>
      !url ||
      url.startsWith("https://") ||
      url.startsWith("http://localhost") ||
      url.startsWith("http://127.0.0.1"),
    { message: "El enlace debe comenzar con https://." },
  )
  .refine(
    (url) => {
      if (!url) return true;
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    },
    { message: "URL inválida." },
  );

export const publicPlatformBrandingSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(100),
  logoLightUrl: httpsUrlSchema.nullable().optional(),
  logoDarkUrl: httpsUrlSchema.nullable().optional(),
  faviconUrl: httpsUrlSchema.nullable().optional(),
  primaryColor: hexColorSchema,
  secondaryColor: hexColorSchema,
  supportUrl: httpsUrlSchema.nullable().optional(),
  privacyUrl: httpsUrlSchema.nullable().optional(),
  termsUrl: httpsUrlSchema.nullable().optional(),
  footerText: z.string().trim().max(500).nullable().optional(),
});

export type PublicPlatformBrandingDto = z.infer<typeof publicPlatformBrandingSchema>;

export const platformBrandingSchema = publicPlatformBrandingSchema.extend({
  id: z.string().uuid(),
  senderName: z.string().trim().min(1).max(100),
  senderEmail: z.string().trim().email(),
  updatedAt: z.string(),
  updatedByAdminId: z.string().uuid().nullable().optional(),
});

export type PlatformBrandingDto = z.infer<typeof platformBrandingSchema>;

export const updatePlatformBrandingSchema = z
  .object({
    name: z.string().trim().min(1, "El nombre de la plataforma es obligatorio.").max(100),
    logoLightUrl: httpsUrlSchema.nullable().optional(),
    logoDarkUrl: httpsUrlSchema.nullable().optional(),
    faviconUrl: httpsUrlSchema.nullable().optional(),
    primaryColor: hexColorSchema,
    secondaryColor: hexColorSchema,
    senderName: z.string().trim().min(1, "El nombre del remitente es obligatorio.").max(100),
    senderEmail: z.string().trim().email("El correo del remitente debe ser una dirección válida."),
    supportUrl: httpsUrlSchema.nullable().optional(),
    privacyUrl: httpsUrlSchema.nullable().optional(),
    termsUrl: httpsUrlSchema.nullable().optional(),
    footerText: z.string().trim().max(500, "El texto de pie no puede exceder 500 caracteres.").nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // F9.1 Criterio 3: El servidor rechaza pares de color de marca con contraste menor a 4.5:1 sobre el fondo donde se usan (fondo claro #ffffff).
    const primaryRatio = contrastRatio(data.primaryColor, "#ffffff");
    if (primaryRatio < AA_NORMAL_TEXT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primaryColor"],
        message: `Contraste insuficiente (${primaryRatio.toFixed(2)}:1). WCAG 2.2 AA exige al menos ${AA_NORMAL_TEXT}:1 sobre fondo claro (#ffffff).`,
      });
    }

    const secondaryRatio = contrastRatio(data.secondaryColor, "#ffffff");
    if (secondaryRatio < AA_NORMAL_TEXT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secondaryColor"],
        message: `Contraste insuficiente (${secondaryRatio.toFixed(2)}:1). WCAG 2.2 AA exige al menos ${AA_NORMAL_TEXT}:1 sobre fondo claro (#ffffff).`,
      });
    }
  });

export type UpdatePlatformBrandingDto = z.infer<typeof updatePlatformBrandingSchema>;

export const BRANDING_TARGETS = ["logo_light", "logo_dark", "favicon"] as const;
export type BrandingTarget = (typeof BRANDING_TARGETS)[number];

export const BRANDING_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;
export type BrandingMimeType = (typeof BRANDING_MIME_TYPES)[number];

export const MAX_BRANDING_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_BRANDING_FAVICON_BYTES = 512 * 1024; // 512 KB

export const uploadBrandingAssetSchema = z.object({
  target: z.enum(BRANDING_TARGETS),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(BRANDING_MIME_TYPES),
  sizeBytes: z.number().int().positive(),
  base64Data: z.string().min(1, "El contenido del archivo es obligatorio."),
});

export type UploadBrandingAssetDto = z.infer<typeof uploadBrandingAssetSchema>;

/**
 * Validador estricto y saneador de archivos SVG (F9.1 Criterio 3).
 * Rechaza SVG con scripts, manejadores de eventos o referencias externas.
 */
export function validateAndSanitizeSvg(svgContent: string): { ok: true; sanitized: string } | { ok: false; error: string } {
  const trimmed = svgContent.trim();
  if (!trimmed.includes("<svg") || !trimmed.includes("</svg>")) {
    return { ok: false, error: "El archivo no es un documento SVG válido." };
  }

  // 1. Detección de scripts (<script ...> o </script>)
  if (/<script[\s\S]*?>[\s\S]*?<\/script>/i.test(trimmed) || /<script[\s\S]*?>/i.test(trimmed)) {
    return { ok: false, error: "El SVG contiene etiquetas <script> no permitidas." };
  }

  // 2. Detección de manejadores de eventos (onload, onclick, onerror, onmouseover, etc.)
  if (/\s+on[a-zA-Z]+\s*=/i.test(trimmed)) {
    return { ok: false, error: "El SVG contiene manejadores de eventos inline (on...) no permitidos." };
  }

  // 3. Detección de pseudoprotocolos javascript: o vbscript: o data:text/html
  if (/href\s*=\s*["']?\s*(?:javascript|vbscript|data:text\/html)/i.test(trimmed)) {
    return { ok: false, error: "El SVG contiene pseudoprotocolos ejecutables no permitidos." };
  }

  // 4. Detección de referencias externas no seguras en <image>, <use>, href, xlink:href
  if (/<(?:image|use)\b[^>]*(?:href|xlink:href)\s*=\s*["']?(?:https?:|\/\/|ftp:)/i.test(trimmed)) {
    return { ok: false, error: "El SVG contiene enlaces a imágenes o recursos externos no permitidos." };
  }

  // 5. Detección de @import o url() externos en estilos
  if (/@import\s+(?:url\()?["']?(?:https?:|\/\/)/i.test(trimmed) || /url\s*\(\s*["']?(?:https?:|\/\/)/i.test(trimmed)) {
    return { ok: false, error: "El SVG contiene estilos con referencias externas no permitidas." };
  }

  // 6. Detección de foreignObject
  if (/<foreignObject[\s\S]*?>/i.test(trimmed)) {
    return { ok: false, error: "El SVG contiene elementos foreignObject no permitidos." };
  }

  // 7. Detección de entidades XML externas (XXE)
  if (/<!ENTITY/i.test(trimmed) || /<!DOCTYPE[^>]*SYSTEM/i.test(trimmed)) {
    return { ok: false, error: "El SVG contiene definiciones de entidades externas no permitidas." };
  }

  return { ok: true, sanitized: trimmed };
}
