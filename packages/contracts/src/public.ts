import { z } from "zod";
import { isoDateTime } from "./primitives.js";

// Contratos del render público (F2.7): lo que ve un visitante sin sesión. Deliberadamente **no**
// derivan de `siteResponse`/`pageResponse`/`blockResponse` (contratos de la API autenticada,
// F2.2–F2.4): un visitante anónimo no necesita ni debe recibir `id`, `organizationId`, `themeId`
// ni ningún otro identificador interno — minimizar lo que se expone en la única superficie
// alcanzable sin autenticación es la misma disciplina que "404 y no 403 por id cruzado" del resto
// de la API, aplicada a lo que se decide mostrar y no solo a lo que se decide bloquear.
//
// Toda decisión de qué mostrar (bloques visibles, dentro de su ventana programada, sin degradar)
// ya se resolvió en el servidor antes de responder — `apps/web` no filtra nada, solo renderiza lo
// que recibe (ARCHITECTURE.md §3: "apps/web ... sin lógica de negocio; consume la API").

export const publicThemeResponse = z.object({
  /** Forma exacta en `@impulza/validation` (`ThemeTokens`) — mismo criterio que otros `unknown`. */
  tokens: z.unknown(),
});

/** Entrada de navegación: solo páginas publicadas y con visibilidad `PUBLIC` (F2.3). */
export const publicNavPageResponse = z.object({
  slug: z.string(),
  isHome: z.boolean(),
  /** Cuándo se publicó la versión vigente — el `lastmod` real de `sitemap.xml` (F2.8), no la
   *  última edición del borrador. */
  publishedAt: isoDateTime,
});

export const publicSiteResponse = z.object({
  name: z.string(),
  slug: z.string(),
  theme: publicThemeResponse,
  /** Fondo de la página ya resuelto (PP3, `resolvedSiteBackgroundSchema` en `@impulza/validation`).
   *  `null` = el fondo del tema. */
  background: z.unknown().nullable(),
  /** Ordenadas por `position`. Una página `HIDDEN` no aparece acá, pero sigue siendo alcanzable
   *  por enlace directo — mismo criterio que la API autenticada (F2.3). */
  pages: z.array(publicNavPageResponse),
});

export const publicBlockResponse = z.object({
  /** Posición del bloque en la versión publicada (F3.6): con esto y el slug de la página, la API
   *  atribuye un clic a su bloque sin que el visitante reciba el id interno (ver arriba). */
  position: z.number().int(),
  type: z.string(),
  /** Forma según `type`, catálogo en `@impulza/validation` — mismo criterio que `BlockResponse`. */
  config: z.unknown(),
  /**
   * Acción principal de la página (PP5): el render la destaca y, en el teléfono, la deja fija
   * abajo. Opcional en el contrato a propósito: una respuesta guardada en caché antes de PP5 (o una
   * API anterior durante un despliegue) sigue siendo válida y simplemente no tiene acción principal.
   */
  primary: z.boolean().optional(),
  /**
   * Prueba A/B en curso sobre este bloque (F6.5, ADR-011). `apps/web` elige la variante con
   * `abVariantFor(key, grupo)` y, en B, aplica `variantB` (solo texto/estilo) sobre `config`. Sin
   * nombres, fechas ni resultados: nada interno. Opcional: sin prueba, no viene.
   */
  experiment: z.object({ key: z.string(), variantB: z.record(z.string(), z.unknown()) }).optional(),
});

// Duplicado a propósito de `SEO_ROBOTS_VALUES`/`SeoRobots` de `@impulza/validation` — mismo
// criterio que `pageVisibility` más arriba en `sites.ts`: este paquete no depende de `validation`
// (se mantiene sin dependencias de workspace), así que el valor cerrado se repite acá, no se
// importa. Si el catálogo de `@impulza/validation` cambia, este también tiene que cambiar.
export const PUBLIC_SEO_ROBOTS_VALUES = ["index_follow", "noindex_follow", "index_nofollow", "noindex_nofollow"] as const;
export const publicSeoRobots = z.enum(PUBLIC_SEO_ROBOTS_VALUES);

export const publicOpenGraphResponse = z.object({
  title: z.string(),
  description: z.string().optional(),
  /** http/https únicamente (misma regla que cualquier imagen de bloque, F2.4). */
  image: z.string().optional(),
});

/**
 * SEO ya resuelto (F2.8): a diferencia de `Page.seoMeta` de la API autenticada (lo que el usuario
 * escribió, todo opcional), esto es lo que `apps/web` pinta tal cual — con los valores por defecto
 * ya derivados del contenido cuando el usuario no puso nada (`PublicSitesService.resolveSeo`).
 * `canonicalPath` es relativo (`/mi-sitio` o `/mi-sitio/servicios`): `apps/web` arma la URL
 * absoluta con su propio origen, este contrato no asume ningún dominio.
 */
export const publicSeoResponse = z.object({
  title: z.string(),
  description: z.string().optional(),
  canonicalPath: z.string(),
  robots: publicSeoRobots,
  openGraph: publicOpenGraphResponse,
});

export const publicPageResponse = z.object({
  slug: z.string(),
  isHome: z.boolean(),
  seo: publicSeoResponse,
  /**
   * Ya filtrados: sin los ocultos, sin los fuera de su ventana programada y sin los degradados
   * (tipo desconocido, versión futura o configuración inválida — F2.4). En el orden en que se
   * publicaron.
   */
  blocks: z.array(publicBlockResponse),
});

export type PublicThemeResponse = z.infer<typeof publicThemeResponse>;
export type PublicNavPageResponse = z.infer<typeof publicNavPageResponse>;
export type PublicSiteResponse = z.infer<typeof publicSiteResponse>;
export type PublicBlockResponse = z.infer<typeof publicBlockResponse>;
export type PublicOpenGraphResponse = z.infer<typeof publicOpenGraphResponse>;
export type PublicSeoResponse = z.infer<typeof publicSeoResponse>;
export type PublicPageResponse = z.infer<typeof publicPageResponse>;
