import type { MediaAssetResponse, MediaLibraryResponse, MediaUploadResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

export function getMediaLibrary(organizationId: string): Promise<MediaLibraryResponse> {
  return apiFetch<MediaLibraryResponse>(`/organizations/${organizationId}/media`);
}

export function getMediaAsset(organizationId: string, assetId: string): Promise<MediaAssetResponse> {
  return apiFetch<MediaAssetResponse>(`/organizations/${organizationId}/media/${assetId}`);
}

export function requestMediaUpload(
  organizationId: string,
  body: { fileName: string; contentType: string; sizeBytes: number },
): Promise<MediaUploadResponse> {
  return apiFetch<MediaUploadResponse>(`/organizations/${organizationId}/media/uploads`, { method: "POST", body });
}

export function confirmMediaUpload(organizationId: string, assetId: string): Promise<MediaAssetResponse> {
  return apiFetch<MediaAssetResponse>(`/organizations/${organizationId}/media/${assetId}/confirm`, { method: "POST" });
}

export function deleteMediaAsset(organizationId: string, assetId: string): Promise<void> {
  return apiFetch<void>(`/organizations/${organizationId}/media/${assetId}`, { method: "DELETE" });
}
