import type { ThemeResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

/** Catálogo global primero, luego los temas propios de la organización (F2.5). */
export function listThemes(organizationId: string): Promise<ThemeResponse[]> {
  return apiFetch<ThemeResponse[]>(`/organizations/${organizationId}/themes`);
}

export function getTheme(organizationId: string, themeId: string): Promise<ThemeResponse> {
  return apiFetch<ThemeResponse>(`/organizations/${organizationId}/themes/${themeId}`);
}

/** Copia editable (tema propio) de un tema del catálogo o propio: único camino para personalizar uno del catálogo. */
export function duplicateTheme(organizationId: string, themeId: string, name?: string): Promise<ThemeResponse> {
  return apiFetch<ThemeResponse>(`/organizations/${organizationId}/themes/${themeId}/duplicate`, {
    method: "POST",
    body: name === undefined ? {} : { name },
  });
}

/** Los tokens van completos, nunca a medias (el servidor verifica el contraste AA de toda la paleta). */
export function updateTheme(organizationId: string, themeId: string, changes: { name?: string; tokens?: unknown }): Promise<ThemeResponse> {
  return apiFetch<ThemeResponse>(`/organizations/${organizationId}/themes/${themeId}`, { method: "PATCH", body: changes });
}

/** 204. Un tema aplicado a algún sitio responde 409 con un mensaje que la pantalla muestra tal cual. */
export function deleteTheme(organizationId: string, themeId: string): Promise<void> {
  return apiFetch<void>(`/organizations/${organizationId}/themes/${themeId}`, { method: "DELETE" });
}
