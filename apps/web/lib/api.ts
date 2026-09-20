import { publicPageResponse, publicSiteResponse, type PublicPageResponse, type PublicSiteResponse } from "@impulza/contracts";
import { env } from "./env";

/**
 * Todo el árbol de un sitio (metadatos + cada página) se cachea bajo esta misma etiqueta, para
 * poder invalidarlo entero con una sola llamada cuando se publica cualquier página (F2.7). Es
 * deliberadamente de grano grueso —publicar una página invalida también las demás páginas del
 * mismo sitio que no cambiaron— a cambio de una garantía simple de mantener: nunca puede quedar
 * una página desactualizada mientras otra del mismo sitio ya se actualizó.
 *
 * Por slug, no por id: el contrato público nunca expone ids internos (ver `@impulza/contracts`),
 * así que el slug es lo único que este proceso conoce para identificar un sitio. Ver
 * `RevalidateWebService` en apps/api, que resuelve el slug vigente antes de avisar acá.
 */
export function siteCacheTag(siteSlug: string): string {
  return `site:${siteSlug}`;
}

/** `path` con `/` inicial, p. ej. `/public/sites/mi-sitio`. Concatenación simple a propósito: la
 * forma correcta de anexar bajo un `API_BASE_URL` que ya trae un path (`/api/v1`) — `new URL(path,
 * base)` con un `path` que empieza en `/` **reemplaza** el path de `base` en vez de extenderlo. */
async function fetchPublic<T>(path: string, siteSlug: string, schema: { parse: (value: unknown) => T }): Promise<T | null> {
  const response = await fetch(`${env.API_BASE_URL}${path}`, {
    cache: "force-cache",
    next: { tags: [siteCacheTag(siteSlug)] },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`La API pública respondió ${response.status} para ${path}`);
  }

  // Se valida contra el mismo contrato que documenta OpenAPI: si algún día este proceso y
  // apps/api quedan en versiones que ya no coinciden, falla acá con un mensaje claro, no en medio
  // de intentar renderizar un bloque con una forma inesperada.
  return schema.parse(await response.json());
}

export function getPublicSite(siteSlug: string): Promise<PublicSiteResponse | null> {
  return fetchPublic(`/public/sites/${encodeURIComponent(siteSlug)}`, siteSlug, publicSiteResponse);
}

export function getPublicPage(siteSlug: string, pageSlug: string): Promise<PublicPageResponse | null> {
  return fetchPublic(
    `/public/sites/${encodeURIComponent(siteSlug)}/pages/${encodeURIComponent(pageSlug)}`,
    siteSlug,
    publicPageResponse,
  );
}
