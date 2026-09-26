import type { SiteDomainResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

function domainsPath(organizationId: string, siteId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/domains`;
}

export function listSiteDomains(organizationId: string, siteId: string): Promise<SiteDomainResponse[]> {
  return apiFetch<SiteDomainResponse[]>(domainsPath(organizationId, siteId));
}

export function addSiteDomain(organizationId: string, siteId: string, domain: string): Promise<SiteDomainResponse> {
  return apiFetch<SiteDomainResponse>(domainsPath(organizationId, siteId), { method: "POST", body: { domain } });
}

export function verifySiteDomain(organizationId: string, siteId: string, domainId: string): Promise<SiteDomainResponse> {
  return apiFetch<SiteDomainResponse>(`${domainsPath(organizationId, siteId)}/${domainId}/verify`, { method: "POST" });
}

export function removeSiteDomain(organizationId: string, siteId: string, domainId: string): Promise<void> {
  return apiFetch<void>(`${domainsPath(organizationId, siteId)}/${domainId}`, { method: "DELETE" });
}
