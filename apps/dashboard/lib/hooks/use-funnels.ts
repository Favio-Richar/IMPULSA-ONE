import type { CreateFunnelInput, UpdateFunnelInput } from "@impulza/validation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFunnel, deleteFunnel, getFunnelReport, listFunnels, updateFunnel, type FunnelReportFilters } from "../api/funnels";

// `organizationId` y `siteId` en cada clave (mismo criterio que use-sites): cambiar de organización o
// de sitio nunca muestra, ni por un instante, embudos de otro.
function funnelsKey(organizationId: string, siteId: string) {
  return ["funnels", organizationId, siteId] as const;
}

export function useFunnels(organizationId: string, siteId: string | null) {
  return useQuery({
    queryKey: funnelsKey(organizationId, siteId ?? ""),
    queryFn: () => listFunnels(organizationId, siteId!),
    enabled: siteId !== null,
  });
}

export function useFunnelReport(organizationId: string, siteId: string, funnelId: string | null, filters: FunnelReportFilters) {
  return useQuery({
    queryKey: [...funnelsKey(organizationId, siteId), funnelId, "report", filters],
    queryFn: () => getFunnelReport(organizationId, siteId, funnelId!, filters),
    enabled: funnelId !== null,
    // Al cambiar de rango o dispositivo, el informe anterior sigue visible mientras llega el nuevo.
    placeholderData: keepPreviousData,
  });
}

export function useSaveFunnel(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ funnelId, input }: { funnelId: string | null; input: CreateFunnelInput | UpdateFunnelInput }) =>
      funnelId === null
        ? createFunnel(organizationId, siteId, input as CreateFunnelInput)
        : updateFunnel(organizationId, siteId, funnelId, input as UpdateFunnelInput),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: funnelsKey(organizationId, siteId) });
    },
  });
}

export function useDeleteFunnel(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (funnelId: string) => deleteFunnel(organizationId, siteId, funnelId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: funnelsKey(organizationId, siteId) });
    },
  });
}
