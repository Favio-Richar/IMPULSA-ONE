import type { FunnelReportResponse, FunnelResponse } from "@impulza/contracts";
import type { CreateFunnelInput, FunnelDevice, UpdateFunnelInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

function funnelsPath(organizationId: string, siteId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/funnels`;
}

export function listFunnels(organizationId: string, siteId: string): Promise<FunnelResponse[]> {
  return apiFetch<FunnelResponse[]>(funnelsPath(organizationId, siteId));
}

export function createFunnel(organizationId: string, siteId: string, input: CreateFunnelInput): Promise<FunnelResponse> {
  return apiFetch<FunnelResponse>(funnelsPath(organizationId, siteId), { method: "POST", body: input });
}

export function updateFunnel(organizationId: string, siteId: string, funnelId: string, input: UpdateFunnelInput): Promise<FunnelResponse> {
  return apiFetch<FunnelResponse>(`${funnelsPath(organizationId, siteId)}/${funnelId}`, { method: "PATCH", body: input });
}

export function deleteFunnel(organizationId: string, siteId: string, funnelId: string): Promise<void> {
  return apiFetch<void>(`${funnelsPath(organizationId, siteId)}/${funnelId}`, { method: "DELETE" });
}

export interface FunnelReportFilters {
  from: string;
  to: string;
  device?: FunnelDevice;
}

export function getFunnelReport(organizationId: string, siteId: string, funnelId: string, filters: FunnelReportFilters): Promise<FunnelReportResponse> {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.device) {
    params.set("device", filters.device);
  }
  return apiFetch<FunnelReportResponse>(`${funnelsPath(organizationId, siteId)}/${funnelId}/report?${params.toString()}`);
}
