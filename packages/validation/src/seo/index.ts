import { z } from "zod";
import { safeUrlSchema } from "../blocks/primitives.js";
import { pageSlugSchema } from "../slug.js";

// SEO por página (F2.8): título, descripción, canonical, robots y Open Graph. Editable, pero de un
// conjunto cerrado — igual que temas (F2.5) y bloques (F2.4), nunca HTML/meta libre (ST §22): un
// `<meta>` arbitrario es tan buen vector de inyección como un `<script>`.

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 200;

export const seoTitleSchema = z.string().trim().min(1).max(SEO_TITLE_MAX);
export const seoDescriptionSchema = z.string().trim().min(1).max(SEO_DESCRIPTION_MAX);

// Las cuatro combinaciones reales de `<meta name="robots">`, como un solo valor cerrado en vez de
// dos booleanos independientes: evita que el editor del constructor (F2.9) tenga que entender qué
// combinación de "index"/"follow" corresponde a qué caso de uso.
export const SEO_ROBOTS_VALUES = ["index_follow", "noindex_follow", "index_nofollow", "noindex_nofollow"] as const;
export const seoRobotsSchema = z.enum(SEO_ROBOTS_VALUES);
export type SeoRobots = z.infer<typeof seoRobotsSchema>;

export const seoOpenGraphSchema = z.object({
  title: seoTitleSchema.optional(),
  description: seoDescriptionSchema.optional(),
  // Misma regla que cualquier imagen de bloque (F2.4): solo http/https, nunca `javascript:`/`data:`.
  image: safeUrlSchema.optional(),
});

/**
 * Lo que el editor guarda para una página (`Page.seoMeta`). Todo opcional a propósito: sin nada
 * acá, el render público deriva título y descripción del contenido real de la página (ver
 * `resolveSeo` en `apps/api/src/modules/public-sites`) en vez de dejar un `<title>` vacío.
 *
 * `canonicalPageSlug` apunta a OTRA página **del mismo sitio** por su slug, nunca a una URL libre:
 * así el canonical sirve para consolidar contenido duplicado dentro de un mismo sitio (el caso real
 * que pide ST §9) sin abrir una vía para desviar el SEO propio hacia un dominio ajeno. `null` es
 * "esta misma página" (el valor por defecto real); el servidor vuelve a resolver el slug al momento
 * de servir la página, así que un valor que apuntó a una página luego borrada o despublicada no
 * rompe el render: cae de vuelta al canonical propio.
 */
export const seoMetaSchema = z.object({
  title: seoTitleSchema.optional(),
  description: seoDescriptionSchema.optional(),
  canonicalPageSlug: pageSlugSchema.nullable().optional(),
  robots: seoRobotsSchema.optional(),
  openGraph: seoOpenGraphSchema.optional(),
});

export type SeoMeta = z.infer<typeof seoMetaSchema>;
export type SeoOpenGraph = z.infer<typeof seoOpenGraphSchema>;
