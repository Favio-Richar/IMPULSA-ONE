import type { AiTaskCode, AiBlockCopyRequest, AiSeoRequest, AiTranslateRequest } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAiStatus, proposeBlockCopy, proposeSeo, translateBlock } from "../api/ai";

function statusKey(organizationId: string) {
  return ["ai", organizationId, "status"] as const;
}

/**
 * Estado del asistente (F6.2): qué tareas tienen un modelo configurado y cuánto queda de la cuota.
 * El panel oculta cada función de IA cuya tarea no esté disponible, así que sin conexiones
 * configuradas el constructor se ve igual que antes.
 */
export function useAiStatus(organizationId: string) {
  return useQuery({ queryKey: statusKey(organizationId), queryFn: () => getAiStatus(organizationId), staleTime: 60_000 });
}

export function isAiTaskAvailable(status: { availableTasks: string[] } | undefined, task: AiTaskCode): boolean {
  return status?.availableTasks.includes(task) ?? false;
}

// Cada propuesta consume cuota: al terminar (bien o mal) se refresca el estado para que el contador
// del diálogo sea el real.

export function useProposeBlockCopy(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AiBlockCopyRequest) => proposeBlockCopy(organizationId, siteId, pageId, body),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: statusKey(organizationId) }),
  });
}

export function useTranslateBlock(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AiTranslateRequest) => translateBlock(organizationId, siteId, pageId, body),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: statusKey(organizationId) }),
  });
}

export function useProposeSeo(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AiSeoRequest) => proposeSeo(organizationId, siteId, pageId, body),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: statusKey(organizationId) }),
  });
}
