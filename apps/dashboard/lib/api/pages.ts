import type { PageHealthResponse, PageResponse, PageVersionResponse, PageVersionSummaryResponse } from "@impulza/contracts";
import type { SeoMeta } from "@impulza/validation";
import { apiFetch } from "../api-client";

function pagesPath(organizationId: string, siteId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/pages`;
}

export function listPages(organizationId: string, siteId: string): Promise<PageResponse[]> {
  return apiFetch<PageResponse[]>(pagesPath(organizationId, siteId));
}

export function getPage(organizationId: string, siteId: string, pageId: string): Promise<PageResponse> {
  return apiFetch<PageResponse>(`${pagesPath(organizationId, siteId)}/${pageId}`);
}

export function createPage(
  organizationId: string,
  siteId: string,
  slug: string,
  visibility?: "PUBLIC" | "HIDDEN",
): Promise<PageResponse> {
  return apiFetch<PageResponse>(pagesPath(organizationId, siteId), {
    method: "POST",
    body: { slug, visibility },
  });
}

/** Manda el orden completo, no un movimiento relativo (mismo criterio que la API, F2.3). */
export function reorderPages(organizationId: string, siteId: string, pageIds: string[]): Promise<PageResponse[]> {
  return apiFetch<PageResponse[]>(`${pagesPath(organizationId, siteId)}/reorder`, {
    method: "PUT",
    body: { pageIds },
  });
}

export function updatePage(
  organizationId: string,
  siteId: string,
  pageId: string,
  changes: { slug?: string; visibility?: "PUBLIC" | "HIDDEN"; seoMeta?: SeoMeta | null },
): Promise<PageResponse> {
  return apiFetch<PageResponse>(`${pagesPath(organizationId, siteId)}/${pageId}`, {
    method: "PATCH",
    body: changes,
  });
}

/** Borrado lógico: la página va a la papelera, no se destruye (F2.3). */
export function deletePage(organizationId: string, siteId: string, pageId: string): Promise<PageResponse> {
  return apiFetch<PageResponse>(`${pagesPath(organizationId, siteId)}/${pageId}`, { method: "DELETE" });
}

export function restorePage(organizationId: string, siteId: string, pageId: string): Promise<PageResponse> {
  return apiFetch<PageResponse>(`${pagesPath(organizationId, siteId)}/${pageId}/restore`, { method: "POST" });
}

/** Idempotente del lado del servidor: publicar sin cambios no crea una versión nueva (F2.6). */
export function publishPage(organizationId: string, siteId: string, pageId: string): Promise<PageVersionResponse> {
  return apiFetch<PageVersionResponse>(`${pagesPath(organizationId, siteId)}/${pageId}/publish`, { method: "POST" });
}

export function listPageVersions(
  organizationId: string,
  siteId: string,
  pageId: string,
): Promise<PageVersionSummaryResponse[]> {
  return apiFetch<PageVersionSummaryResponse[]>(`${pagesPath(organizationId, siteId)}/${pageId}/versions`);
}

export function getPageVersion(
  organizationId: string,
  siteId: string,
  pageId: string,
  versionId: string,
): Promise<PageVersionResponse> {
  return apiFetch<PageVersionResponse>(`${pagesPath(organizationId, siteId)}/${pageId}/versions/${versionId}`);
}

/** Crea una versión nueva con el contenido restaurado — nunca reescribe el historial (F2.6). */
export function restorePageVersion(
  organizationId: string,
  siteId: string,
  pageId: string,
  versionId: string,
): Promise<PageVersionResponse> {
  return apiFetch<PageVersionResponse>(
    `${pagesPath(organizationId, siteId)}/${pageId}/versions/${versionId}/restore`,
    { method: "POST" },
  );
}

/** Salud de la página (F6.1): la calcula el servidor sobre el estado vivo. */
export function getPageHealth(organizationId: string, siteId: string, pageId: string): Promise<PageHealthResponse> {
  return apiFetch<PageHealthResponse>(`${pagesPath(organizationId, siteId)}/${pageId}/health`);
}
