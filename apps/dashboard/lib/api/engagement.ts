import type { SiteEngagementResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

// Vistas y «me gusta» de cada página de un sitio (F10).
export function getSiteEngagement(organizationId: string, siteId: string): Promise<SiteEngagementResponse> {
  return apiFetch<SiteEngagementResponse>(`/organizations/${organizationId}/sites/${siteId}/engagement`);
}
