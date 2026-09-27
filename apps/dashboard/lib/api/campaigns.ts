import type { CampaignAudienceResponse, CampaignResponse, CampaignSegmentOptionsResponse } from "@impulza/contracts";
import type { CampaignInput, CampaignSegment, UpdateCampaignInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

// Campañas de email (F5.6).

const base = (organizationId: string) => `/organizations/${organizationId}/campaigns`;

export function listCampaigns(organizationId: string): Promise<CampaignResponse[]> {
  return apiFetch<CampaignResponse[]>(base(organizationId));
}

export function getCampaign(organizationId: string, campaignId: string): Promise<CampaignResponse> {
  return apiFetch<CampaignResponse>(`${base(organizationId)}/${campaignId}`);
}

export function createCampaign(organizationId: string, body: CampaignInput): Promise<CampaignResponse> {
  return apiFetch<CampaignResponse>(base(organizationId), { method: "POST", body });
}

export function updateCampaign(organizationId: string, campaignId: string, body: UpdateCampaignInput): Promise<CampaignResponse> {
  return apiFetch<CampaignResponse>(`${base(organizationId)}/${campaignId}`, { method: "PATCH", body });
}

export function deleteCampaign(organizationId: string, campaignId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId)}/${campaignId}`, { method: "DELETE" });
}

export function campaignAudience(organizationId: string, segment: CampaignSegment): Promise<CampaignAudienceResponse> {
  return apiFetch<CampaignAudienceResponse>(`${base(organizationId)}/audience`, { method: "POST", body: segment });
}

export function campaignSegmentOptions(organizationId: string): Promise<CampaignSegmentOptionsResponse> {
  return apiFetch<CampaignSegmentOptionsResponse>(`${base(organizationId)}/segment-options`);
}

export function sendCampaignTest(organizationId: string, campaignId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId)}/${campaignId}/test`, { method: "POST" });
}

export function sendCampaign(organizationId: string, campaignId: string): Promise<CampaignResponse> {
  return apiFetch<CampaignResponse>(`${base(organizationId)}/${campaignId}/send`, { method: "POST" });
}

export function cancelCampaign(organizationId: string, campaignId: string): Promise<CampaignResponse> {
  return apiFetch<CampaignResponse>(`${base(organizationId)}/${campaignId}/cancel`, { method: "POST" });
}
