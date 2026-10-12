import type { MarketplaceInstallResponse, MarketplaceOrganizationResponse, MarketplaceSubmissionResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

// Marketplace de integraciones y plantillas, desde el panel (F10.6, ADR-029).

const base = (organizationId: string): string => `/organizations/${organizationId}/marketplace`;

export type SubmitCommon = { name: string; summary: string; description: string; partnerName: string; partnerUrl?: string; version: string };
export type SubmitTemplate = SubmitCommon & {
  kind: "TEMPLATE";
  template: { themeCode: string; industryTags: string[]; objectiveTags: string[]; blocksSeed: Array<{ type: string; configSchemaVersion: number; config: unknown; isPrimary?: true }> };
};
export type SubmitIntegration = SubmitCommon & { kind: "INTEGRATION"; integration: { events: string[]; instructions?: string } };

export function getMarketplace(organizationId: string): Promise<MarketplaceOrganizationResponse> {
  return apiFetch<MarketplaceOrganizationResponse>(base(organizationId));
}

export function installListing(organizationId: string, listingId: string, body: { webhookUrl?: string }): Promise<MarketplaceInstallResponse> {
  return apiFetch<MarketplaceInstallResponse>(`${base(organizationId)}/${listingId}/install`, { method: "POST", body });
}

export function uninstallListing(organizationId: string, listingId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId)}/${listingId}/install`, { method: "DELETE" });
}

export function submitListing(organizationId: string, body: SubmitTemplate | SubmitIntegration): Promise<MarketplaceSubmissionResponse> {
  return apiFetch<MarketplaceSubmissionResponse>(`${base(organizationId)}/submissions`, { method: "POST", body });
}

export function withdrawListing(organizationId: string, listingId: string): Promise<MarketplaceSubmissionResponse> {
  return apiFetch<MarketplaceSubmissionResponse>(`${base(organizationId)}/submissions/${listingId}/withdraw`, { method: "POST" });
}
