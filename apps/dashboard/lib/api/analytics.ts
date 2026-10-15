import type { AnalyticsOverviewResponse, BlockClicksResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

export interface AnalyticsOverviewFilters {
  /** `YYYY-MM-DD`, días UTC (los agregados del pipeline son diarios en UTC, F3.6). */
  from: string;
  to: string;
  siteId?: string;
}

export function getAnalyticsOverview(
  organizationId: string,
  filters: AnalyticsOverviewFilters,
): Promise<AnalyticsOverviewResponse> {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.siteId) {
    params.set("siteId", filters.siteId);
  }
  return apiFetch<AnalyticsOverviewResponse>(`/organizations/${organizationId}/analytics/overview?${params.toString()}`);
}

/** Clics de un bloque en los últimos `days` días (30 por defecto; el servidor lo acota al historial del plan). */
export function getBlockClicks(organizationId: string, blockId: string, days = 30): Promise<BlockClicksResponse> {
  return apiFetch<BlockClicksResponse>(`/organizations/${organizationId}/analytics/blocks/${blockId}/clicks?days=${days}`);
}
