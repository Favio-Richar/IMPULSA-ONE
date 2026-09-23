import type { ShortLinkResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

function shortLinksPath(organizationId: string): string {
  return `/organizations/${organizationId}/short-links`;
}

export function listShortLinks(organizationId: string): Promise<ShortLinkResponse[]> {
  return apiFetch<ShortLinkResponse[]>(shortLinksPath(organizationId));
}

export function createShortLink(
  organizationId: string,
  body: { slug: string; destinationUrl: string },
): Promise<ShortLinkResponse> {
  return apiFetch<ShortLinkResponse>(shortLinksPath(organizationId), { method: "POST", body });
}

export function updateShortLink(
  organizationId: string,
  shortLinkId: string,
  changes: { destinationUrl?: string },
): Promise<ShortLinkResponse> {
  return apiFetch<ShortLinkResponse>(`${shortLinksPath(organizationId)}/${shortLinkId}`, {
    method: "PATCH",
    body: changes,
  });
}

export function deleteShortLink(organizationId: string, shortLinkId: string): Promise<void> {
  return apiFetch<void>(`${shortLinksPath(organizationId)}/${shortLinkId}`, { method: "DELETE" });
}
