import type { QrCodeResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

function qrCodesPath(organizationId: string): string {
  return `/organizations/${organizationId}/qr-codes`;
}

export function listQrCodes(organizationId: string): Promise<QrCodeResponse[]> {
  return apiFetch<QrCodeResponse[]>(qrCodesPath(organizationId));
}

export function createQrCode(
  organizationId: string,
  body: { shortLinkId?: string; directUrl?: string; styleKey: string },
): Promise<QrCodeResponse> {
  return apiFetch<QrCodeResponse>(qrCodesPath(organizationId), { method: "POST", body });
}

export function deleteQrCode(organizationId: string, qrCodeId: string): Promise<void> {
  return apiFetch<void>(`${qrCodesPath(organizationId)}/${qrCodeId}`, { method: "DELETE" });
}
