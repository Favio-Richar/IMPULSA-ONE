import { useQuery } from "@tanstack/react-query";
import { listTemplates, type TemplateFilters } from "../api/templates";

/** Catálogo global (no depende de la organización activa): la clave no lleva `organizationId`. */
export function useTemplates(filters: TemplateFilters) {
  return useQuery({
    queryKey: ["templates", filters.industry ?? null, filters.objective ?? null, filters.family ?? null],
    queryFn: () => listTemplates(filters),
    // Contenido de la plataforma que cambia solo con un despliegue: no hace falta volver a pedirlo
    // cada vez que se cambia de paso o de filtro ya visitado.
    staleTime: 5 * 60 * 1000,
  });
}
