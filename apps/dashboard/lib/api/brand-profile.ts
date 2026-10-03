import type { BrandProfileResponse } from "@impulza/contracts";
import type { UpdateBrandProfileDto, UploadBrandingAssetDto } from "@impulza/validation";
import { apiFetch } from "../api-client";

/**
 * Obtiene el perfil de marca de la organización (F9.2, ADR-028 §4 nivel 2).
 */
export async function getOrgBrandProfile(organizationId: string): Promise<BrandProfileResponse> {
  return apiFetch<BrandProfileResponse>(`/organizations/${organizationId}/brand-profile`);
}

/**
 * Actualiza el perfil de marca de la organización.
 * Solo puede modificar la marca de su propia organización (aislamiento verificado en el servidor).
 */
export async function updateOrgBrandProfile(
  organizationId: string,
  data: UpdateBrandProfileDto,
): Promise<BrandProfileResponse> {
  return apiFetch<BrandProfileResponse>(`/organizations/${organizationId}/brand-profile`, {
    method: "PUT",
    body: data,
  });
}

/**
 * Sube un logotipo o favicon para la organización activa.
 * El servidor valida SVG saneado, dimensiones mínimas y tipo de archivo.
 */
export async function uploadOrgBrandProfileAsset(
  organizationId: string,
  data: UploadBrandingAssetDto,
): Promise<{ url: string }> {
  return apiFetch<{ url: string }>(`/organizations/${organizationId}/brand-profile/upload`, {
    method: "POST",
    body: data,
  });
}
