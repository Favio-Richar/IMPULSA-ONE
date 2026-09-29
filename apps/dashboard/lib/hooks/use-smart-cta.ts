import type { SmartCta } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSmartCta, saveSmartCta } from "../api/smart-cta";

function smartCtaKey(organizationId: string, siteId: string, pageId: string) {
  return ["smart-cta", organizationId, siteId, pageId] as const;
}

/** Reglas de Smart CTA de la página (F6.6). */
export function useSmartCta(organizationId: string, siteId: string, pageId: string) {
  return useQuery({ queryKey: smartCtaKey(organizationId, siteId, pageId), queryFn: () => getSmartCta(organizationId, siteId, pageId) });
}

export function useSaveSmartCta(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SmartCta) => saveSmartCta(organizationId, siteId, pageId, body),
    onSuccess: (data) => queryClient.setQueryData(smartCtaKey(organizationId, siteId, pageId), data),
  });
}
