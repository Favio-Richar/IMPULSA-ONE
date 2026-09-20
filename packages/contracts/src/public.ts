import { z } from "zod";

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
});

export const publicSiteResponse = z.object({
  name: z.string(),
  slug: z.string(),
  theme: publicThemeResponse,
  /** Ordenadas por `position`. Una página `HIDDEN` no aparece acá, pero sigue siendo alcanzable
   *  por enlace directo — mismo criterio que la API autenticada (F2.3). */
  pages: z.array(publicNavPageResponse),
});

export const publicBlockResponse = z.object({
  type: z.string(),
  /** Forma según `type`, catálogo en `@impulza/validation` — mismo criterio que `BlockResponse`. */
  config: z.unknown(),
});

export const publicPageResponse = z.object({
  slug: z.string(),
  isHome: z.boolean(),
  /** Forma pendiente de F2.8 (SEO base); por ahora se pasa tal cual, sin interpretar. */
  seoMeta: z.unknown().nullable(),
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
export type PublicPageResponse = z.infer<typeof publicPageResponse>;
