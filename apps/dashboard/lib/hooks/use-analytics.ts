import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAnalyticsOverview, getBlockClicks, type AnalyticsOverviewFilters } from "../api/analytics";

export function useAnalyticsOverview(organizationId: string, filters: AnalyticsOverviewFilters) {
  return useQuery({
    queryKey: ["analytics-overview", organizationId, filters],
    queryFn: () => getAnalyticsOverview(organizationId, filters),
    enabled: organizationId !== "",
    // Al cambiar de rango o de sitio se mantiene visible el resumen anterior mientras llega el
    // nuevo, en vez de vaciar toda la pantalla a un estado de carga en cada clic de filtro.
    placeholderData: keepPreviousData,
  });
}

/** Clics de un bloque para su panel en el constructor. Un minuto de frescura: los agregados se actualizan por lotes. */
export function useBlockClicks(organizationId: string, blockId: string) {
  return useQuery({
    queryKey: ["block-clicks", organizationId, blockId],
    queryFn: () => getBlockClicks(organizationId, blockId),
    enabled: organizationId !== "" && blockId !== "",
    staleTime: 60_000,
  });
}
