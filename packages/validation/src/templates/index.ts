import { z } from "zod";
import { findImagesWithoutAlt, IMAGE_ALT_REQUIRED_MESSAGE } from "../blocks/primitives.js";
import { getBlockDefinition, isPrimaryActionBlockType } from "../blocks/catalog.js";
import { siteBackgroundSchema } from "../backgrounds/index.js";
import { getCatalogTheme, THEME_FAMILIES } from "../themes/catalog.js";

// Plantillas (PL1, PM §7.4, ERD `Template`). Una plantilla es la combinación de un tema del
// catálogo, un fondo y un set inicial de bloques con contenido de ejemplo por rubro. Es contenido
// **global de la plataforma** (como los planes y el catálogo de temas), nunca dato de un tenant:
// no pertenece a ninguna organización y solo se lee.
//
// Este archivo es la única definición de qué es una plantilla válida. Lo usa el seed antes de
// escribir, la API al leer cada fila (el JSON de Postgres no se cree a ciegas) y el constructor al
// aplicarla (PL4) — así una plantilla con un bloque inválido no puede ni guardarse ni servirse.

/**
 * Objetivos del plan maestro (§7.1 punto 4, §14.1 "página guiada por objetivo"). Cerrados: son los
 * filtros de la galería y la respuesta del paso "Objetivo principal" del onboarding (§8.2).
 */
export const TEMPLATE_OBJECTIVES = ["captar", "vender", "reservar", "mostrar", "compartir"] as const;
export type TemplateObjective = (typeof TEMPLATE_OBJECTIVES)[number];

export const TEMPLATE_OBJECTIVE_LABELS: Record<TemplateObjective, string> = {
  captar: "Captar clientes",
  vender: "Vender",
  reservar: "Recibir reservas",
  mostrar: "Mostrar mi trabajo",
  compartir: "Compartir mis enlaces",
};

/**
 * Industrias, alineadas a los segmentos del plan maestro (§4). Cerradas por la misma razón que los
 * objetivos: son filtros y la respuesta del paso "Industria" del onboarding. Agregar una es agregar
 * una entrada acá (y su etiqueta), sin migración: la columna es `text[]`.
 */
export const TEMPLATE_INDUSTRIES = [
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
] as const;
export type TemplateIndustry = (typeof TEMPLATE_INDUSTRIES)[number];

export const TEMPLATE_INDUSTRY_LABELS: Record<TemplateIndustry, string> = {
  profesional: "Profesionales y servicios",
  "servicios-locales": "Negocios locales",
  "belleza-bienestar": "Belleza y bienestar",
  salud: "Salud",
  gastronomia: "Café y gastronomía",
  turismo: "Turismo",
  eventos: "Eventos",
  comercio: "Comercio y tiendas",
  creador: "Creadores y artistas",
  emprendimiento: "Emprendedores",
};

export const templateCodeSchema = z
  .string()
  .trim()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Usa minúsculas, números y guiones.");

/**
 * Fondo de una plantilla: el mismo esquema que `Site.background`, **limitado a color y degradado**.
 * Una foto o un video necesitan un archivo en la biblioteca de medios de la organización (ADR-006,
 * y los tonos medidos para verificar el contraste de la capa), y una plantilla no puede traer medios
 * de nadie. `null` = el fondo por defecto del tema (degradado oscuro en la línea `oscuro`, PL2).
 */
export const templateBackgroundSchema = siteBackgroundSchema
  .refine((background) => background.kind === "color" || background.kind === "gradient", {
    message: "Una plantilla solo puede traer un fondo de color o degradado.",
  })
  .nullable();

/**
 * Un bloque de la plantilla, en el mismo formato que un bloque del snapshot de `PageVersion`
 * (`type`, `configSchemaVersion`, `isPrimary` y `config`), sin los campos que dependen de una
 * página real (`id`, fechas de programación). La posición es el orden de la lista. Todos quedan
 * visibles al aplicar la plantilla.
 */
export const templateBlockSeedSchema = z.object({
  type: z.string(),
  configSchemaVersion: z.number().int().min(1),
  isPrimary: z.literal(true).optional(),
  config: z.unknown(),
});
export type TemplateBlockSeed = z.infer<typeof templateBlockSeedSchema>;

export const TEMPLATE_MAX_BLOCKS = 30;

/**
 * La lista de bloques se valida con **los mismos esquemas Zod del constructor** (`BLOCK_CATALOG`):
 * tipo conocido, versión igual a la vigente (una plantilla siempre se escribe con la versión
 * actual), configuración válida, imágenes con texto alternativo (la regla de escritura de PP2) y a
 * lo sumo una acción principal, solo en un bloque de acción (PP5). Un formulario de contacto va
 * siempre sin configurar (`formId: null`): el formulario real es de cada organización.
 */
export const templateBlocksSeedSchema = z
  .array(templateBlockSeedSchema)
  .min(1)
  .max(TEMPLATE_MAX_BLOCKS)
  .superRefine((blocks, ctx) => {
    let primaryCount = 0;

    blocks.forEach((block, index) => {
      const definition = getBlockDefinition(block.type);

      if (!definition) {
        ctx.addIssue({ code: "custom", path: [index, "type"], message: `Tipo de bloque desconocido: ${block.type}` });
        return;
      }

      if (block.configSchemaVersion !== definition.version) {
        ctx.addIssue({
          code: "custom",
          path: [index, "configSchemaVersion"],
          message: `El bloque "${block.type}" va en la versión ${definition.version} de su esquema.`,
        });
      }

      const parsed = definition.schema.safeParse(block.config);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          ctx.addIssue({ code: "custom", path: [index, "config", ...issue.path], message: issue.message });
        }
        return;
      }

      for (const path of findImagesWithoutAlt(parsed.data)) {
        ctx.addIssue({ code: "custom", path: [index, "config", ...path], message: IMAGE_ALT_REQUIRED_MESSAGE });
      }

      if (block.type === "contact_form" && (parsed.data as { formId: string | null }).formId !== null) {
        ctx.addIssue({
          code: "custom",
          path: [index, "config", "formId"],
          message: "Una plantilla no puede apuntar a un formulario: cada organización conecta el suyo.",
        });
      }

      if (block.isPrimary) {
        primaryCount += 1;
        if (!isPrimaryActionBlockType(block.type)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "isPrimary"],
            message: "Solo un bloque de acción (WhatsApp, enlace o formulario) puede ser la acción principal.",
          });
        }
      }
    });

    if (primaryCount > 1) {
      ctx.addIssue({ code: "custom", message: "Una plantilla tiene a lo sumo una acción principal." });
    }
  });

function uniqueTags<T extends string>(values: readonly [T, ...T[]]) {
  return z
    .array(z.enum(values))
    .min(1)
    .refine((tags) => new Set(tags).size === tags.length, { message: "Hay etiquetas repetidas." });
}

/**
 * Plantilla completa. `family` es la línea de estilo (filtro "estilo" de PM §7.4) y **tiene que ser
 * la del tema**: guardarla por separado permite filtrar sin cargar el catálogo de temas, pero nunca
 * puede contradecirlo.
 */
export const templateSchema = z
  .object({
    code: templateCodeSchema,
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().min(10).max(300),
    industryTags: uniqueTags(TEMPLATE_INDUSTRIES),
    objectiveTags: uniqueTags(TEMPLATE_OBJECTIVES),
    themeCode: z.string().refine((code) => getCatalogTheme(code) !== undefined, {
      message: "El tema no existe en el catálogo.",
    }),
    family: z.enum(THEME_FAMILIES),
    background: templateBackgroundSchema,
    // Opcional: la galería (PL4) muestra la plantilla real renderizada, no una captura. Si algún
    // día hay capturas, son de la biblioteca de Impulza, nunca de un tercero (ADR-008).
    previewImageUrl: z
      .url()
      .refine((url) => url.startsWith("https://"), { message: "La vista previa tiene que servirse por https." })
      .nullable(),
    blocksSeed: templateBlocksSeedSchema,
    sortOrder: z.number().int().min(0),
  })
  .superRefine((template, ctx) => {
    const theme = getCatalogTheme(template.themeCode);
    if (theme && theme.family !== template.family) {
      ctx.addIssue({
        code: "custom",
        path: ["family"],
        message: `La línea de la plantilla tiene que ser la del tema ("${theme.family}").`,
      });
    }
  });

export type TemplateDefinition = z.infer<typeof templateSchema>;
