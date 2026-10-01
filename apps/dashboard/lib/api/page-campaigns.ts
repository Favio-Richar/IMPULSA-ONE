import type { PageCampaignReportResponse, PageCampaignResponse } from "@impulza/contracts";
import type { CreatePageCampaignInput, UpdatePageCampaignInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

function campaignsPath(organizationId: string, siteId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/page-campaigns`;
}

export function listPageCampaigns(organizationId: string, siteId: string): Promise<PageCampaignResponse[]> {
  return apiFetch<PageCampaignResponse[]>(campaignsPath(organizationId, siteId));
}

export function createPageCampaign(organizationId: string, siteId: string, input: CreatePageCampaignInput): Promise<PageCampaignResponse> {
  return apiFetch<PageCampaignResponse>(campaignsPath(organizationId, siteId), { method: "POST", body: input });
}

export function updatePageCampaign(
  organizationId: string,
  siteId: string,
  campaignId: string,
  input: UpdatePageCampaignInput,
): Promise<PageCampaignResponse> {
  return apiFetch<PageCampaignResponse>(`${campaignsPath(organizationId, siteId)}/${campaignId}`, { method: "PATCH", body: input });
}

export function cancelPageCampaign(organizationId: string, siteId: string, campaignId: string): Promise<PageCampaignResponse> {
  return apiFetch<PageCampaignResponse>(`${campaignsPath(organizationId, siteId)}/${campaignId}/cancel`, { method: "POST" });
}

export function deletePageCampaign(organizationId: string, siteId: string, campaignId: string): Promise<void> {
  return apiFetch<void>(`${campaignsPath(organizationId, siteId)}/${campaignId}`, { method: "DELETE" });
}

export function getPageCampaignReport(organizationId: string, siteId: string, campaignId: string): Promise<PageCampaignReportResponse> {
  return apiFetch<PageCampaignReportResponse>(`${campaignsPath(organizationId, siteId)}/${campaignId}/report`);
}
