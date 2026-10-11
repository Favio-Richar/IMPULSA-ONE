import type { PanelBrandResponse, SetClientWhiteLabelResponse, WhiteLabelSettingsResponse } from "@impulza/contracts";
import type { UpdateWhiteLabelDto, UploadBrandingAssetDto } from "@impulza/validation";
import { apiFetch } from "../api-client";

// Marca blanca de la agencia (F9.7a, ADR-028 §4). El servidor valida y decide; la pantalla solo muestra el resultado.

const base = (organizationId: string) => `/organizations/${organizationId}/agency/white-label`;

export function getWhiteLabel(organizationId: string): Promise<WhiteLabelSettingsResponse> {
  return apiFetch<WhiteLabelSettingsResponse>(base(organizationId));
}

export function updateWhiteLabel(organizationId: string, body: UpdateWhiteLabelDto): Promise<WhiteLabelSettingsResponse> {
  return apiFetch<WhiteLabelSettingsResponse>(base(organizationId), { method: "PUT", body });
}

export function uploadWhiteLabelAsset(organizationId: string, body: UploadBrandingAssetDto): Promise<{ url: string }> {
  return apiFetch<{ url: string }>(`${base(organizationId)}/upload`, { method: "POST", body });
}

export function setClientWhiteLabel(organizationId: string, relationId: string, enabled: boolean): Promise<SetClientWhiteLabelResponse> {
  return apiFetch<SetClientWhiteLabelResponse>(`${base(organizationId)}/clients/${relationId}`, { method: "PUT", body: { enabled } });
}

export function getPanelBrand(organizationId: string): Promise<PanelBrandResponse> {
  return apiFetch<PanelBrandResponse>(`/organizations/${organizationId}/panel-brand`);
}
