import { z } from "zod";
import {
  publicBookingAvailableResponse,
  publicFormResponse,
  publicPageResponse,
  publicSiteResponse,
  planResponse,
  templateResponse,
  type PublicFormResponse,
  type PublicPageResponse,
  type PublicSiteResponse,
  type PlanResponse,
  type TemplateResponse,
} from "@impulza/contracts";
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

/** F3.2: la definición real de un formulario referenciado por un bloque `contact_form`. `null` si
 *  el formulario ya no existe (se borró desde entonces) — el bloque lo trata como "sin configurar",
 *  igual que un `formId` vacío (ver `ContactFormBlock`), nunca como un error de render. */
export function getPublicForm(siteSlug: string, formId: string): Promise<PublicFormResponse | null> {
  return fetchPublic(
    `/public/sites/${encodeURIComponent(siteSlug)}/forms/${encodeURIComponent(formId)}`,
    siteSlug,
    publicFormResponse,
  );
}

/**
 * Smart CTA (F6.6): ¿quedan horas para reservar? Caché propia de un minuto, aparte de la del sitio:
 * cambia con cada reserva, no con cada publicación. Ante cualquier falla, `null` (la regla no se
 * cumple: nunca se cambia el botón por adivinar).
 */
export async function getBookingAvailable(siteSlug: string): Promise<boolean | null> {
  try {
    const response = await fetch(`${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/booking/available`, {
      next: { revalidate: 60 },
      headers: { "X-Requested-With": "impulza-one" },
    });
    if (!response.ok) {
      return null;
    }
    return publicBookingAvailableResponse.parse(await response.json()).available;
  } catch {
    return null;
  }
}

/**
 * Catálogo público de plantillas y de planes (PL1, F4.1) — no dependen de un sitio, así que no
 * llevan `siteCacheTag`: los invalida el próximo despliegue, no una publicación de un cliente.
 * Usados por la home comercial (`app/page.tsx`) para mostrar datos reales, no maquetados.
 */
async function fetchCatalog<T>(path: string, schema: { parse: (value: unknown) => T }): Promise<T | null> {
  const response = await fetch(`${env.API_BASE_URL}${path}`, { next: { revalidate: 300 } });
  if (!response.ok) return null;
  return schema.parse(await response.json());
}

export async function getTemplateCatalog(): Promise<TemplateResponse[]> {
  return (await fetchCatalog("/templates", z.array(templateResponse))) ?? [];
}

export async function getPlanCatalog(): Promise<PlanResponse[]> {
  return (await fetchCatalog("/plans", z.array(planResponse))) ?? [];
}
