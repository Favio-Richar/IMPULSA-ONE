import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { exportAudit, listAudit, type AuditFilters } from "../api/audit";

export function useAudit(organizationId: string, view: "organization" | "agency", filters: AuditFilters, limit: number, offset: number) {
  return useQuery({
    queryKey: ["audit", organizationId, view, filters, limit, offset] as const,
    queryFn: () => listAudit(organizationId, view, filters, limit, offset),
    // Al paginar o filtrar se mantiene la lista anterior en pantalla hasta que llega la nueva.
    placeholderData: keepPreviousData,
  });
}

/** Exportar queda registrado en la auditoría: se refresca la lista para que la persona lo vea aparecer. */
export function useExportAudit(organizationId: string, view: "organization" | "agency") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filters: AuditFilters) => exportAudit(organizationId, view, filters),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["audit", organizationId] }),
  });
}
