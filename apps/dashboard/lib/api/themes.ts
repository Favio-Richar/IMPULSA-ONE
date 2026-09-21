import type { ThemeResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

/** Catálogo global primero, luego los temas propios de la organización (F2.5). */
export function listThemes(organizationId: string): Promise<ThemeResponse[]> {
  return apiFetch<ThemeResponse[]>(`/organizations/${organizationId}/themes`);
}

export function getTheme(organizationId: string, themeId: string): Promise<ThemeResponse> {
  return apiFetch<ThemeResponse>(`/organizations/${organizationId}/themes/${themeId}`);
}
