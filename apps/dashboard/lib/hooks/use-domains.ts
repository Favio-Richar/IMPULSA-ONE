import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addSiteDomain, listSiteDomains, removeSiteDomain, verifySiteDomain } from "../api/domains";

function key(organizationId: string, siteId: string) {
  return ["site-domains", organizationId, siteId] as const;
}

export function useSiteDomains(organizationId: string, siteId: string) {
  return useQuery({ queryKey: key(organizationId, siteId), queryFn: () => listSiteDomains(organizationId, siteId) });
}

export function useAddSiteDomain(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) => addSiteDomain(organizationId, siteId, domain),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(organizationId, siteId) }),
  });
}

export function useVerifySiteDomain(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => verifySiteDomain(organizationId, siteId, domainId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(organizationId, siteId) }),
  });
}

export function useRemoveSiteDomain(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => removeSiteDomain(organizationId, siteId, domainId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(organizationId, siteId) }),
  });
}
