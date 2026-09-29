import type { CreateAutomationInput, UpdateAutomationInput } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAutomation, deleteAutomation, listAutomationRuns, listAutomations, updateAutomation } from "../api/automations";

function automationsKey(organizationId: string) {
  return ["automations", organizationId] as const;
}

/** Automatizaciones de la organización (F6.7), con sus ejecuciones recientes. */
export function useAutomations(organizationId: string) {
  return useQuery({ queryKey: automationsKey(organizationId), queryFn: () => listAutomations(organizationId), refetchInterval: 60_000 });
}

export function useAutomationRuns(organizationId: string, automationId: string | null) {
  return useQuery({
    queryKey: [...automationsKey(organizationId), automationId, "runs"] as const,
    queryFn: () => listAutomationRuns(organizationId, automationId!),
    enabled: automationId !== null,
  });
}

export function useCreateAutomation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAutomationInput) => createAutomation(organizationId, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationsKey(organizationId) }),
  });
}

export function useUpdateAutomation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ automationId, changes }: { automationId: string; changes: UpdateAutomationInput }) => updateAutomation(organizationId, automationId, changes),
    // Se devuelve la promesa: la mutación sigue "pendiente" hasta tener la lista nueva, así la
    // pantalla puede mostrar el valor pedido sin parpadear al valor viejo entre medio.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: automationsKey(organizationId) }),
  });
}

export function useDeleteAutomation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (automationId: string) => deleteAutomation(organizationId, automationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: automationsKey(organizationId) }),
  });
}
