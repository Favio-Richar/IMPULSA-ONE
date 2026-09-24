import { useQuery } from "@tanstack/react-query";
import { getOrganizationPlan, listPlans } from "../api/plans";

export function usePlanCatalog() {
  return useQuery({ queryKey: ["plans"], queryFn: listPlans, staleTime: 5 * 60 * 1000 });
}

export function useOrganizationPlan(organizationId: string) {
  return useQuery({
    queryKey: ["organization-plan", organizationId],
    queryFn: () => getOrganizationPlan(organizationId),
  });
}
