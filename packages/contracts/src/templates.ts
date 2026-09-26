import { z } from "zod";
import { uuid } from "./primitives.js";

// Catálogo de plantillas (PL1). Las listas cerradas se repiten acá porque este paquete no depende
// de `@impulza/validation` (mismo criterio que `themeResponse.family`); la fuente de verdad sigue
// siendo `TEMPLATE_INDUSTRIES`/`TEMPLATE_OBJECTIVES`/`THEME_FAMILIES` y las pruebas e2e de la API
// parsean respuestas reales contra este contrato, así que una desalineación rompe la suite.

export const templateIndustry = z.enum([
  "profesional",
  "servicios-locales",
  "belleza-bienestar",
  "salud",
  "gastronomia",
  "turismo",
  "eventos",
  "comercio",
  "creador",
  "emprendimiento",
]);

export const templateObjective = z.enum(["captar", "vender", "reservar", "mostrar", "compartir"]);

export const templateFamily = z.enum(["oscuro", "ejecutivo", "vibrante", "clasico"]);

export const templateBlockSeedResponse = z.object({
  type: z.string(),
  configSchemaVersion: z.number().int(),
  /** Solo presente (y `true`) en la acción principal de la plantilla (PP5). */
  isPrimary: z.literal(true).optional(),
  /** Configuración de ejemplo, ya validada contra el esquema del tipo en `@impulza/validation`. */
  config: z.unknown(),
});

export const templateResponse = z.object({
  id: uuid,
  /** Identificador estable (`profesional-servicios`, …): lo que el cliente manda para aplicarla. */
  code: z.string(),
  name: z.string(),
  description: z.string(),
  industryTags: z.array(templateIndustry),
  objectiveTags: z.array(templateObjective),
  /** Línea de estilo: siempre la del tema. Filtro "estilo" de la galería (PM §7.4). */
  family: templateFamily,
  /**
   * Tema del catálogo con sus tokens, para pintar la vista previa sin otra petición (la galería del
   * onboarding puede verse antes de tener una organización). Forma de `tokens`:
   * `themeTokensSchema` de `@impulza/validation`.
   */
  theme: z.object({ code: z.string(), name: z.string(), tokens: z.unknown() }),
  /** `siteBackgroundSchema` (solo color o degradado), o `null` = el fondo del tema. */
  background: z.unknown().nullable(),
  previewImageUrl: z.string().nullable(),
  /** Bloques iniciales, en orden. */
  blocks: z.array(templateBlockSeedResponse),
});

export type TemplateResponse = z.infer<typeof templateResponse>;
export type TemplateBlockSeedResponse = z.infer<typeof templateBlockSeedResponse>;
