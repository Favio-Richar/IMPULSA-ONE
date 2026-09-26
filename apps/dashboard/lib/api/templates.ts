import type { ApplyTemplateResponse, TemplateResponse } from "@impulza/contracts";
import type { ApplyTemplateInput, TemplateIndustry, TemplateObjective, ThemeFamily } from "@impulza/validation";
import { apiFetch } from "../api-client";

export interface TemplateFilters {
  industry?: TemplateIndustry;
  objective?: TemplateObjective;
  family?: ThemeFamily;
}

/** Catálogo de plantillas (PL1): sin sesión ni organización, así lo usa también el onboarding. */
export function listTemplates(filters: TemplateFilters = {}): Promise<TemplateResponse[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return apiFetch<TemplateResponse[]>(`/templates${query ? `?${query}` : ""}`);
}

/**
 * Aplica una plantilla a una página (PL4). 409 con `code: "UNPUBLISHED_CHANGES"` si la página tiene
 * cambios que ninguna versión guarda y no se confirmó descartarlos: quien llama lo pregunta y reintenta.
 */
export function applyTemplate(
  organizationId: string,
  siteId: string,
  pageId: string,
  input: Partial<ApplyTemplateInput> & { templateCode: string },
): Promise<ApplyTemplateResponse> {
  return apiFetch<ApplyTemplateResponse>(`/organizations/${organizationId}/sites/${siteId}/pages/${pageId}/apply-template`, {
    method: "POST",
    body: input,
  });
}
