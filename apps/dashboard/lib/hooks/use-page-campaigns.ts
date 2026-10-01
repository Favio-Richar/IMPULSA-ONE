import type { CreatePageCampaignInput, UpdatePageCampaignInput } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelPageCampaign,
  createPageCampaign,
  deletePageCampaign,
  getPageCampaignReport,
  listPageCampaigns,
  updatePageCampaign,
} from "../api/page-campaigns";

function campaignsKey(organizationId: string, siteId: string) {
  return ["page-campaigns", organizationId, siteId] as const;
}

export function usePageCampaigns(organizationId: string, siteId: string) {
  return useQuery({ queryKey: campaignsKey(organizationId, siteId), queryFn: () => listPageCampaigns(organizationId, siteId) });
}

export function usePageCampaignReport(organizationId: string, siteId: string, campaignId: string) {
  return useQuery({
    queryKey: [...campaignsKey(organizationId, siteId), campaignId, "report"],
    queryFn: () => getPageCampaignReport(organizationId, siteId, campaignId),
  });
}

/** Crear o editar, y después volver a pedir la lista (el estado lo calcula el servidor). */
export function useSavePageCampaign(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, input }: { campaignId: string | null; input: CreatePageCampaignInput | UpdatePageCampaignInput }) =>
      campaignId === null
        ? createPageCampaign(organizationId, siteId, input as CreatePageCampaignInput)
        : updatePageCampaign(organizationId, siteId, campaignId, input as UpdatePageCampaignInput),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: campaignsKey(organizationId, siteId) }),
  });
}

export function useCancelPageCampaign(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) => cancelPageCampaign(organizationId, siteId, campaignId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: campaignsKey(organizationId, siteId) }),
  });
}

export function useDeletePageCampaign(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) => deletePageCampaign(organizationId, siteId, campaignId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: campaignsKey(organizationId, siteId) }),
  });
}
