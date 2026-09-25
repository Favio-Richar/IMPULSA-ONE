import type { SiteBackgroundResponse, SiteResponse, SiteThemeResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

export function listSites(organizationId: string): Promise<SiteResponse[]> {
  return apiFetch<SiteResponse[]>(`/organizations/${organizationId}/sites`);
}

export function getSite(organizationId: string, siteId: string): Promise<SiteResponse> {
  return apiFetch<SiteResponse>(`/organizations/${organizationId}/sites/${siteId}`);
}

export function createSite(organizationId: string, name: string, slug: string): Promise<SiteResponse> {
  return apiFetch<SiteResponse>(`/organizations/${organizationId}/sites`, {
    method: "POST",
    body: { name, slug },
  });
}

export function updateSite(
  organizationId: string,
  siteId: string,
  changes: { name?: string; slug?: string },
): Promise<SiteResponse> {
  return apiFetch<SiteResponse>(`/organizations/${organizationId}/sites/${siteId}`, {
    method: "PATCH",
    body: changes,
  });
}

export function archiveSite(organizationId: string, siteId: string): Promise<SiteResponse> {
  return apiFetch<SiteResponse>(`/organizations/${organizationId}/sites/${siteId}/archive`, {
    method: "POST",
  });
}

export function getSiteTheme(organizationId: string, siteId: string): Promise<SiteThemeResponse> {
  return apiFetch<SiteThemeResponse>(`/organizations/${organizationId}/sites/${siteId}/theme`);
}

/** `themeId: null` devuelve el sitio al tema por defecto del catálogo — es un valor con
 *  significado propio, no un campo que se pueda omitir (mismo criterio que el backend, F2.5). */
export function assignSiteTheme(
  organizationId: string,
  siteId: string,
  themeId: string | null,
): Promise<SiteResponse> {
  return apiFetch<SiteResponse>(`/organizations/${organizationId}/sites/${siteId}/theme`, {
    method: "PUT",
    body: { themeId },
  });
}

export function getSiteBackground(organizationId: string, siteId: string): Promise<SiteBackgroundResponse> {
  return apiFetch<SiteBackgroundResponse>(`/organizations/${organizationId}/sites/${siteId}/background`);
}

/** `background: null` vuelve al fondo del tema (PP3) — mismo criterio que `assignSiteTheme`. */
export function setSiteBackground(organizationId: string, siteId: string, background: unknown): Promise<SiteBackgroundResponse> {
  return apiFetch<SiteBackgroundResponse>(`/organizations/${organizationId}/sites/${siteId}/background`, {
    method: "PUT",
    body: { background },
  });
}
