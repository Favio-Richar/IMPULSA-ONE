import type { AiBlockProposalsResponse, AiSeoProposalsResponse, AiStatusResponse } from "@impulza/contracts";
import type { AiBlockCopyRequest, AiSeoRequest, AiTranslateRequest } from "@impulza/validation";
import { apiFetch } from "../api-client";

function pageAiPath(organizationId: string, siteId: string, pageId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/pages/${pageId}/ai`;
}

export function getAiStatus(organizationId: string): Promise<AiStatusResponse> {
  return apiFetch<AiStatusResponse>(`/organizations/${organizationId}/ai/status`);
}

export function proposeBlockCopy(organizationId: string, siteId: string, pageId: string, body: AiBlockCopyRequest): Promise<AiBlockProposalsResponse> {
  return apiFetch<AiBlockProposalsResponse>(`${pageAiPath(organizationId, siteId, pageId)}/block-copy`, { method: "POST", body });
}

export function translateBlock(organizationId: string, siteId: string, pageId: string, body: AiTranslateRequest): Promise<AiBlockProposalsResponse> {
  return apiFetch<AiBlockProposalsResponse>(`${pageAiPath(organizationId, siteId, pageId)}/translate`, { method: "POST", body });
}

export function proposeSeo(organizationId: string, siteId: string, pageId: string, body: AiSeoRequest): Promise<AiSeoProposalsResponse> {
  return apiFetch<AiSeoProposalsResponse>(`${pageAiPath(organizationId, siteId, pageId)}/seo`, { method: "POST", body });
}
