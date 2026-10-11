import { z } from "zod";
import { uuid } from "./primitives.js";
import { blockResponse } from "./sites.js";

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
  "educacion",
]);

export const templateObjective = z.enum(["captar", "vender", "reservar", "mostrar", "compartir"]);

export const templateFamily = z.enum(["oscuro", "minimal", "ejecutivo", "vibrante", "clasico"]);

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

/**
 * Resultado de aplicar una plantilla a una página (PL4). `blocks` son los bloques nuevos, en orden
 * (forma de `blockResponse`). `appearance.previous` es el tema y el fondo que tenía el sitio antes,
 * para ofrecer "deshacer" la apariencia: los bloques anteriores se recuperan desde el historial de
 * versiones, pero el tema y el fondo se aplican en vivo y no tienen historial propio.
 */
export const applyTemplateResponse = z.object({
  templateCode: z.string(),
  pageId: uuid,
  blocks: z.array(blockResponse),
  appearance: z.object({
    applied: z.boolean(),
    previous: z.object({ themeId: uuid.nullable(), background: z.unknown().nullable() }),
  }),
});

export type ApplyTemplateResponse = z.infer<typeof applyTemplateResponse>;
export type TemplateBlockSeedResponse = z.infer<typeof templateBlockSeedResponse>;

// ---- plantillas privadas (F9.7c, ADR-028) -------------------------------------------------------------------------------
// Los cuerpos de petición viven en `@impulza/validation` (`templates/private`).

export const privateTemplateResponse = templateResponse.extend({
  /** La organización dueña (una agencia o el propio negocio). */
  ownerOrganizationId: uuid,
  /** `true` si la plantilla es de la agencia con la que se trabaja este negocio (no del negocio). */
  fromAgency: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type PrivateTemplateResponse = z.infer<typeof privateTemplateResponse>;

