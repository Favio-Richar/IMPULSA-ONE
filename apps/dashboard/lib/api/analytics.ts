import type { AnalyticsOverviewResponse } from "@impulza/contracts";
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
