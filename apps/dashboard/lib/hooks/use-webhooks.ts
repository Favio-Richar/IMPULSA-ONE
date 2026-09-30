import type { CreateWebhookEndpointInput, ListWebhookDeliveriesQuery, SendWebhookTestInput, UpdateWebhookEndpointInput } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookDelivery,
  listWebhookDeliveries,
  listWebhookEndpoints,
  redeliverWebhook,
  rotateWebhookSecret,
  sendWebhookTest,
  updateWebhookEndpoint,
} from "../api/webhooks";

function webhooksKey(organizationId: string) {
  return ["webhooks", organizationId] as const;
}

/** Destinos de webhooks (F7.2). Sin `webhooks.manage` la API responde 403: no se reintenta. */
export function useWebhookEndpoints(organizationId: string) {
  return useQuery({
    queryKey: webhooksKey(organizationId),
    queryFn: () => listWebhookEndpoints(organizationId),
    refetchInterval: 30_000,
    retry: (count, error) => (error as { status?: number }).status !== 403 && count < 2,
  });
}

export function useWebhookDeliveries(organizationId: string, endpointId: string, query: ListWebhookDeliveriesQuery) {
  return useQuery({
    queryKey: [...webhooksKey(organizationId), endpointId, "deliveries", query.status ?? "all"] as const,
    queryFn: () => listWebhookDeliveries(organizationId, endpointId, query),
    // Mientras haya entregas en curso, el registro se actualiza solo.
    refetchInterval: (current) => (current.state.data?.some((delivery) => delivery.status === "PENDING") ? 4_000 : 30_000),
  });
}

export function useWebhookDelivery(organizationId: string, endpointId: string, deliveryId: string | null) {
  return useQuery({
    queryKey: [...webhooksKey(organizationId), endpointId, "delivery", deliveryId] as const,
    queryFn: () => getWebhookDelivery(organizationId, endpointId, deliveryId!),
    enabled: deliveryId !== null,
  });
}

function useInvalidate(organizationId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: webhooksKey(organizationId) });
}

export function useCreateWebhookEndpoint(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (body: CreateWebhookEndpointInput) => createWebhookEndpoint(organizationId, body), onSuccess: () => void invalidate() });
}

export function useUpdateWebhookEndpoint(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({
    mutationFn: ({ endpointId, changes }: { endpointId: string; changes: UpdateWebhookEndpointInput }) => updateWebhookEndpoint(organizationId, endpointId, changes),
    // La mutación sigue "pendiente" hasta tener la lista nueva: el interruptor no parpadea.
    onSuccess: () => invalidate(),
  });
}

export function useDeleteWebhookEndpoint(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (endpointId: string) => deleteWebhookEndpoint(organizationId, endpointId), onSuccess: () => void invalidate() });
}

export function useRotateWebhookSecret(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (endpointId: string) => rotateWebhookSecret(organizationId, endpointId), onSuccess: () => void invalidate() });
}

export function useSendWebhookTest(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({
    mutationFn: ({ endpointId, body }: { endpointId: string; body: SendWebhookTestInput }) => sendWebhookTest(organizationId, endpointId, body),
    onSuccess: () => void invalidate(),
  });
}

export function useRedeliverWebhook(organizationId: string, endpointId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (deliveryId: string) => redeliverWebhook(organizationId, endpointId, deliveryId), onSuccess: () => void invalidate() });
}
