import type {
  PublishRequestCommentResponse,
  PagePublishStatusResponse,
  PublishRequestDetailResponse,
  PublishRequestListResponse,
  PublishRequestSummaryResponse,
  PublishSettingsResponse,
} from "@impulza/contracts";
import type { CreatePublishRequestDto, PublishRequestStatusValue } from "@impulza/validation";
import { apiFetch } from "../api-client";

// Aprobación antes de publicar (F9.6c, ADR-028 §3). La decisión es del servidor: la pantalla solo muestra lo que el servidor deja hacer.

const base = (organizationId: string) => `/organizations/${organizationId}`;
const pagePath = (organizationId: string, siteId: string, pageId: string) => `${base(organizationId)}/sites/${siteId}/pages/${pageId}`;

export function getPagePublishStatus(organizationId: string, siteId: string, pageId: string): Promise<PagePublishStatusResponse> {
  return apiFetch<PagePublishStatusResponse>(`${pagePath(organizationId, siteId, pageId)}/publish-status`);
}

export function requestPublish(
  organizationId: string,
  siteId: string,
  pageId: string,
  body: Partial<Pick<CreatePublishRequestDto, "kind" | "versionId" | "comment">>,
): Promise<PublishRequestSummaryResponse> {
  return apiFetch<PublishRequestSummaryResponse>(`${pagePath(organizationId, siteId, pageId)}/publish-requests`, { method: "POST", body });
}

export interface PublishRequestsQuery {
  status?: PublishRequestStatusValue;
  pageId?: string;
  limit?: number;
  offset?: number;
}

export function listPublishRequests(organizationId: string, query: PublishRequestsQuery = {}): Promise<PublishRequestListResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.pageId) params.set("pageId", query.pageId);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const qs = params.toString();
  return apiFetch<PublishRequestListResponse>(`${base(organizationId)}/publish-requests${qs ? `?${qs}` : ""}`);
}

export function getPublishRequest(organizationId: string, requestId: string): Promise<PublishRequestDetailResponse> {
  return apiFetch<PublishRequestDetailResponse>(`${base(organizationId)}/publish-requests/${requestId}`);
}

export function approvePublishRequest(organizationId: string, requestId: string, comment: string | null): Promise<PublishRequestSummaryResponse> {
  return apiFetch<PublishRequestSummaryResponse>(`${base(organizationId)}/publish-requests/${requestId}/approve`, {
    method: "POST",
    body: { comment },
  });
}

export function rejectPublishRequest(organizationId: string, requestId: string, comment: string): Promise<PublishRequestSummaryResponse> {
  return apiFetch<PublishRequestSummaryResponse>(`${base(organizationId)}/publish-requests/${requestId}/reject`, {
    method: "POST",
    body: { comment },
  });
}

export function cancelPublishRequest(organizationId: string, requestId: string): Promise<PublishRequestSummaryResponse> {
  return apiFetch<PublishRequestSummaryResponse>(`${base(organizationId)}/publish-requests/${requestId}/cancel`, { method: "POST" });
}

export function getPublishSettings(organizationId: string): Promise<PublishSettingsResponse> {
  return apiFetch<PublishSettingsResponse>(`${base(organizationId)}/publish-settings`);
}

export function updatePublishSettings(organizationId: string, requireApproval: boolean): Promise<PublishSettingsResponse> {
  return apiFetch<PublishSettingsResponse>(`${base(organizationId)}/publish-settings`, { method: "PUT", body: { requireApproval } });
}

export function listPublishComments(organizationId: string, requestId: string): Promise<PublishRequestCommentResponse[]> {
  return apiFetch<PublishRequestCommentResponse[]>(`${base(organizationId)}/publish-requests/${requestId}/comments`);
}

export function addPublishComment(organizationId: string, requestId: string, body: string): Promise<PublishRequestCommentResponse> {
  return apiFetch<PublishRequestCommentResponse>(`${base(organizationId)}/publish-requests/${requestId}/comments`, { method: "POST", body: { body } });
}
