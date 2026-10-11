import type { MemberSettingsResponse, SiteMemberListResponse, SiteMemberResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

// Miembros de un sitio y páginas solo para miembros (F10.1, ADR-029).

const base = (organizationId: string, siteId: string): string => `/organizations/${organizationId}/sites/${siteId}/members`;

export function getMemberSettings(organizationId: string, siteId: string): Promise<MemberSettingsResponse> {
  return apiFetch<MemberSettingsResponse>(`${base(organizationId, siteId)}/settings`);
}

export function setPageMembersOnly(organizationId: string, siteId: string, pageId: string, enabled: boolean): Promise<MemberSettingsResponse> {
  return apiFetch<MemberSettingsResponse>(`${base(organizationId, siteId)}/pages/${pageId}`, { method: "PUT", body: { enabled } });
}

export function listSiteMembers(
  organizationId: string,
  siteId: string,
  params: { search?: string; status?: "ACTIVE" | "REVOKED"; page: number; pageSize: number },
): Promise<SiteMemberListResponse> {
  const search = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  if (params.search) search.set("search", params.search);
  if (params.status) search.set("status", params.status);
  return apiFetch<SiteMemberListResponse>(`${base(organizationId, siteId)}?${search.toString()}`);
}

export function addSiteMember(organizationId: string, siteId: string, body: { email: string; name?: string; sendAccess: boolean }): Promise<SiteMemberResponse> {
  return apiFetch<SiteMemberResponse>(base(organizationId, siteId), { method: "POST", body });
}

export function revokeSiteMember(organizationId: string, siteId: string, memberId: string): Promise<SiteMemberResponse> {
  return apiFetch<SiteMemberResponse>(`${base(organizationId, siteId)}/${memberId}/revoke`, { method: "POST" });
}

export function restoreSiteMember(organizationId: string, siteId: string, memberId: string): Promise<SiteMemberResponse> {
  return apiFetch<SiteMemberResponse>(`${base(organizationId, siteId)}/${memberId}/restore`, { method: "POST" });
}

export function removeSiteMember(organizationId: string, siteId: string, memberId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId, siteId)}/${memberId}`, { method: "DELETE" });
}
