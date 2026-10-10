import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approvePublishRequest,
  cancelPublishRequest,
  getPagePublishStatus,
  getPublishRequest,
  getPublishSettings,
  listPublishRequests,
  rejectPublishRequest,
  requestPublish,
  updatePublishSettings,
  type PublishRequestsQuery,
} from "../api/publish";

// Cuelga de `["pages", org, site, page]`: lo que invalida la página (publicar, restaurar) refresca también su estado de aprobación.
const statusKey = (organizationId: string, siteId: string, pageId: string) => ["pages", organizationId, siteId, pageId, "publish-status"] as const;
const requestsKey = (organizationId: string) => ["publish-requests", organizationId] as const;
const settingsKey = (organizationId: string) => ["publish-settings", organizationId] as const;

export function usePagePublishStatus(organizationId: string, siteId: string, pageId: string) {
  return useQuery({ queryKey: statusKey(organizationId, siteId, pageId), queryFn: () => getPagePublishStatus(organizationId, siteId, pageId) });
}

export function usePublishRequests(organizationId: string, query: PublishRequestsQuery) {
  return useQuery({ queryKey: [...requestsKey(organizationId), query] as const, queryFn: () => listPublishRequests(organizationId, query) });
}

export function usePublishRequest(organizationId: string, requestId: string | null) {
  return useQuery({
    queryKey: [...requestsKey(organizationId), "detail", requestId] as const,
    queryFn: () => getPublishRequest(organizationId, requestId!),
    enabled: requestId !== null,
  });
}

export function useRequestPublish(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof requestPublish>[3]) => requestPublish(organizationId, siteId, pageId, body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: statusKey(organizationId, siteId, pageId) }),
        queryClient.invalidateQueries({ queryKey: requestsKey(organizationId) }),
      ]);
    },
  });
}

/** Resolver (aprobar, rechazar o cancelar) cambia la cola y el estado de la página de la solicitud. */
function useRefreshRequests(organizationId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: requestsKey(organizationId) }),
      queryClient.invalidateQueries({ queryKey: ["pages", organizationId] }),
    ]);
  };
}

export function useApprovePublishRequest(organizationId: string) {
  const refresh = useRefreshRequests(organizationId);
  return useMutation({
    mutationFn: (input: { requestId: string; comment: string | null }) => approvePublishRequest(organizationId, input.requestId, input.comment),
    onSuccess: refresh,
  });
}

export function useRejectPublishRequest(organizationId: string) {
  const refresh = useRefreshRequests(organizationId);
  return useMutation({
    mutationFn: (input: { requestId: string; comment: string }) => rejectPublishRequest(organizationId, input.requestId, input.comment),
    onSuccess: refresh,
  });
}

export function useCancelPublishRequest(organizationId: string) {
  const refresh = useRefreshRequests(organizationId);
  return useMutation({ mutationFn: (requestId: string) => cancelPublishRequest(organizationId, requestId), onSuccess: refresh });
}

export function usePublishSettings(organizationId: string) {
  return useQuery({ queryKey: settingsKey(organizationId), queryFn: () => getPublishSettings(organizationId) });
}

export function useUpdatePublishSettings(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requireApproval: boolean) => updatePublishSettings(organizationId, requireApproval),
    onSuccess: async () => {
      // Apagar la opción cancela las pendientes y cambia lo que ofrece cada página.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsKey(organizationId) }),
        queryClient.invalidateQueries({ queryKey: requestsKey(organizationId) }),
        queryClient.invalidateQueries({ queryKey: ["pages", organizationId] }),
      ]);
    },
  });
}
