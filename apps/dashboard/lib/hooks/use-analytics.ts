import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getAnalyticsOverview, type AnalyticsOverviewFilters } from "../api/analytics";

export function useAnalyticsOverview(organizationId: string, filters: AnalyticsOverviewFilters) {
  return useQuery({
    queryKey: ["analytics-overview", organizationId, filters],
    queryFn: () => getAnalyticsOverview(organizationId, filters),
    // Al cambiar de rango o de sitio se mantiene visible el resumen anterior mientras llega el
    // nuevo, en vez de vaciar toda la pantalla a un estado de carga en cada clic de filtro.
    placeholderData: keepPreviousData,
  });
}
