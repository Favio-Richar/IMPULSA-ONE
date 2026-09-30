import type { WebhookDeliveryDetailResponse, WebhookDeliveryResponse, WebhookEndpointResponse, WebhookSecretResponse } from "@impulza/contracts";
import type { CreateWebhookEndpointInput, ListWebhookDeliveriesQuery, SendWebhookTestInput, UpdateWebhookEndpointInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

function webhooksPath(organizationId: string): string {
  return `/organizations/${organizationId}/webhooks`;
}

export function listWebhookEndpoints(organizationId: string): Promise<WebhookEndpointResponse[]> {
  return apiFetch<WebhookEndpointResponse[]>(webhooksPath(organizationId));
}

export function createWebhookEndpoint(organizationId: string, body: CreateWebhookEndpointInput): Promise<WebhookSecretResponse> {
  return apiFetch<WebhookSecretResponse>(webhooksPath(organizationId), { method: "POST", body });
}

export function updateWebhookEndpoint(organizationId: string, endpointId: string, body: UpdateWebhookEndpointInput): Promise<WebhookEndpointResponse> {
  return apiFetch<WebhookEndpointResponse>(`${webhooksPath(organizationId)}/${endpointId}`, { method: "PATCH", body });
}

export function deleteWebhookEndpoint(organizationId: string, endpointId: string): Promise<void> {
  return apiFetch<void>(`${webhooksPath(organizationId)}/${endpointId}`, { method: "DELETE" });
}

export function rotateWebhookSecret(organizationId: string, endpointId: string): Promise<WebhookSecretResponse> {
  return apiFetch<WebhookSecretResponse>(`${webhooksPath(organizationId)}/${endpointId}/rotate-secret`, { method: "POST" });
}

export function sendWebhookTest(organizationId: string, endpointId: string, body: SendWebhookTestInput): Promise<WebhookDeliveryResponse> {
  return apiFetch<WebhookDeliveryResponse>(`${webhooksPath(organizationId)}/${endpointId}/test`, { method: "POST", body });
}

export function listWebhookDeliveries(organizationId: string, endpointId: string, query: ListWebhookDeliveriesQuery): Promise<WebhookDeliveryResponse[]> {
  const search = query.status ? `?status=${query.status}` : "";
  return apiFetch<WebhookDeliveryResponse[]>(`${webhooksPath(organizationId)}/${endpointId}/deliveries${search}`);
}

export function getWebhookDelivery(organizationId: string, endpointId: string, deliveryId: string): Promise<WebhookDeliveryDetailResponse> {
  return apiFetch<WebhookDeliveryDetailResponse>(`${webhooksPath(organizationId)}/${endpointId}/deliveries/${deliveryId}`);
}

export function redeliverWebhook(organizationId: string, endpointId: string, deliveryId: string): Promise<WebhookDeliveryResponse> {
  return apiFetch<WebhookDeliveryResponse>(`${webhooksPath(organizationId)}/${endpointId}/deliveries/${deliveryId}/redeliver`, { method: "POST" });
}
