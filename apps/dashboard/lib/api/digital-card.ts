import type { DigitalCardAdminResponse } from "@impulza/contracts";
import type { DigitalCardDto } from "@impulza/validation";
import { apiFetch } from "../api-client";

// Tarjeta digital del sitio, desde el panel (F10.4, ADR-029).

const path = (organizationId: string, siteId: string): string => `/organizations/${organizationId}/sites/${siteId}/digital-card`;

export function getDigitalCard(organizationId: string, siteId: string): Promise<DigitalCardAdminResponse> {
  return apiFetch<DigitalCardAdminResponse>(path(organizationId, siteId));
}

export function saveDigitalCard(organizationId: string, siteId: string, body: DigitalCardDto): Promise<DigitalCardAdminResponse> {
  return apiFetch<DigitalCardAdminResponse>(path(organizationId, siteId), { method: "PUT", body });
}
