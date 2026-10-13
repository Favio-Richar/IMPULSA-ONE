import type { SubscribePageAdminResponse } from "@impulza/contracts";
import type { SubscribePageDto } from "@impulza/validation";
import { apiFetch } from "../api-client";

// Página de suscripción del sitio, desde el panel (extra F10, ADR-029).

const path = (organizationId: string, siteId: string): string => `/organizations/${organizationId}/sites/${siteId}/subscribe-page`;

export function getSubscribePage(organizationId: string, siteId: string): Promise<SubscribePageAdminResponse> {
  return apiFetch<SubscribePageAdminResponse>(path(organizationId, siteId));
}

export function saveSubscribePage(organizationId: string, siteId: string, body: SubscribePageDto): Promise<SubscribePageAdminResponse> {
  return apiFetch<SubscribePageAdminResponse>(path(organizationId, siteId), { method: "PUT", body });
}
