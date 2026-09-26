import { z } from "zod";
import {
  findImagesWithoutAlt,
  IMAGE_ALT_REQUIRED_MESSAGE,
  phoneSchema,
  safeUrlSchema,
  socialNetworkSchema,
} from "../blocks/primitives.js";
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

// --- Aplicar una plantilla (PL4) ---------------------------------------------------------------

/** Paso 1 del onboarding (PM §8.2). Se registra en la auditoría; el modo agencia es de otra fase. */
export const ONBOARDING_ACCOUNT_TYPES = ["personal", "negocio", "agencia"] as const;
export type OnboardingAccountType = (typeof ONBOARDING_ACCOUNT_TYPES)[number];

export const ONBOARDING_ACCOUNT_TYPE_LABELS: Record<OnboardingAccountType, { label: string; description: string }> = {
  personal: { label: "Personal o marca personal", description: "Profesional independiente, creador o artista." },
  negocio: { label: "Negocio", description: "Un local, una tienda o una empresa de servicios." },
  agencia: { label: "Agencia", description: "Gestionas la presencia digital de tus clientes." },
};

export const TEMPLATE_MAX_IMPORTED_LINKS = 5;
export const TEMPLATE_MAX_IMPORTED_SOCIALS = 8;

/**
 * Lo que el usuario cuenta en el onboarding y reemplaza el contenido de ejemplo de la plantilla:
 * nombre, frase y bio del perfil (paso 8), el número de WhatsApp de la acción principal, y las
 * redes y enlaces que trae (paso 6). Todo opcional: aplicar una plantilla desde el constructor puede
 * no traer nada. Cada bloque resultante vuelve a pasar por el esquema de su tipo en el servidor.
 */
export const templatePersonalizationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  headline: z.string().trim().min(1).max(160).optional(),
  // Texto plano: el servidor lo escapa y lo envuelve en un párrafo antes del saneo normal.
  bio: z.string().trim().min(1).max(500).optional(),
  whatsappPhone: phoneSchema.optional(),
  // Texto y destino del botón principal cuando la acción principal de la plantilla es un enlace.
  primaryLink: z.object({ label: z.string().trim().min(1).max(80), url: safeUrlSchema }).optional(),
  socials: z.array(z.object({ network: socialNetworkSchema, url: safeUrlSchema })).max(TEMPLATE_MAX_IMPORTED_SOCIALS).optional(),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(80), url: safeUrlSchema }))
    .max(TEMPLATE_MAX_IMPORTED_LINKS)
    .optional(),
});
export type TemplatePersonalization = z.infer<typeof templatePersonalizationSchema>;

export const applyTemplateSchema = z.object({
  templateCode: templateCodeSchema,
  /** Aplicar también el tema y el fondo de la plantilla. Se ven en vivo, sin publicar. */
  applyAppearance: z.boolean().default(true),
  /**
   * Confirmación explícita de que se pierden los cambios que ninguna versión guarda. Sin ella, la
   * API responde 409 (`UNPUBLISHED_CHANGES`) en vez de reemplazar: lo publicado se recupera desde
   * el historial, lo no publicado no.
   */
  discardUnpublishedChanges: z.boolean().default(false),
  personalization: templatePersonalizationSchema.optional(),
  /** Respuestas de los pasos 1-3 del onboarding, para la auditoría. */
  onboarding: z
    .object({
      accountType: z.enum(ONBOARDING_ACCOUNT_TYPES),
      objective: z.enum(TEMPLATE_OBJECTIVES),
      industry: z.enum(TEMPLATE_INDUSTRIES),
    })
    .optional(),
});
export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Bloques de la plantilla con la personalización aplicada, en orden. Función pura e isomorfa: el
 * servidor la usa para escribir y el panel para la vista previa del onboarding (paso 9), así lo que
 * se ve es exactamente lo que se guarda.
 *
 * - Perfil: nombre, frase y bio reemplazan los de ejemplo.
 * - WhatsApp: el número reemplaza el de relleno en todos los bloques de WhatsApp.
 * - Enlace principal: si la acción principal es un enlace, toma el texto y el destino del usuario.
 * - Redes: si trae alguna, reemplazan las de ejemplo del bloque de redes.
 * - Enlaces: entran como botones secundarios justo después de los enlaces/WhatsApp de la plantilla.
 */
export function personalizeTemplateBlocks(
  blocks: readonly TemplateBlockSeed[],
  personalization: TemplatePersonalization | undefined,
): TemplateBlockSeed[] {
  if (!personalization) {
    return blocks.map((block) => ({ ...block }));
  }

  const result: TemplateBlockSeed[] = blocks.map((block) => {
    const config = (block.config ?? {}) as Record<string, unknown>;

    if (block.type === "profile") {
      return {
        ...block,
        config: {
          ...config,
          ...(personalization.name ? { name: personalization.name } : {}),
          ...(personalization.headline ? { headline: personalization.headline } : {}),
          ...(personalization.bio ? { bio: `<p>${escapeHtml(personalization.bio)}</p>` } : {}),
        },
      };
    }

    if (block.type === "whatsapp" && personalization.whatsappPhone) {
      return { ...block, config: { ...config, phone: personalization.whatsappPhone } };
    }

    if (block.type === "link" && block.isPrimary && personalization.primaryLink) {
      return { ...block, config: { ...config, label: personalization.primaryLink.label, url: personalization.primaryLink.url } };
    }

    if (block.type === "social" && personalization.socials && personalization.socials.length > 0) {
      return { ...block, config: { ...config, links: personalization.socials } };
    }

    return { ...block };
  });

  const links = personalization.links ?? [];
  if (links.length > 0) {
    const lastActionIndex = result.reduce(
      (last, block, index) => (block.type === "link" || block.type === "whatsapp" ? index : last),
      0,
    );
    const imported: TemplateBlockSeed[] = links.map((link) => ({
      type: "link",
      configSchemaVersion: 1,
      config: { label: link.label, url: link.url, style: "secondary" },
    }));
    result.splice(lastActionIndex + 1, 0, ...imported);
  }

  return result;
}
