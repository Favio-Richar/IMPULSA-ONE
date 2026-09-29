import type { SmartCtaResponse } from "@impulza/contracts";
import type { SmartCta } from "@impulza/validation";
import { apiFetch } from "../api-client";

function smartCtaPath(organizationId: string, siteId: string, pageId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/pages/${pageId}/smart-cta`;
}

export function getSmartCta(organizationId: string, siteId: string, pageId: string): Promise<SmartCtaResponse> {
  return apiFetch<SmartCtaResponse>(smartCtaPath(organizationId, siteId, pageId));
}

export function saveSmartCta(organizationId: string, siteId: string, pageId: string, body: SmartCta): Promise<SmartCtaResponse> {
  return apiFetch<SmartCtaResponse>(smartCtaPath(organizationId, siteId, pageId), { method: "PUT", body });
}
