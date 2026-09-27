import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CampaignInput, CampaignSegment, UpdateCampaignInput } from "@impulza/validation";
import {
  campaignAudience,
  campaignSegmentOptions,
  cancelCampaign,
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  sendCampaign,
  sendCampaignTest,
  updateCampaign,
} from "../api/campaigns";

// Campañas de email (F5.6).

const root = (organizationId: string) => ["campaigns", organizationId] as const;

function useInvalidate(organizationId: string) {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: root(organizationId) });
}

export function useCampaigns(organizationId: string) {
  return useQuery({
    queryKey: [...root(organizationId), "list"],
    queryFn: () => listCampaigns(organizationId),
    // Mientras alguna se envía, el avance se refresca solo.
    refetchInterval: (query) => (query.state.data?.some((campaign) => campaign.status === "SENDING") ? 5_000 : false),
  });
}

export function useCampaign(organizationId: string, campaignId: string) {
  return useQuery({
    queryKey: [...root(organizationId), "detail", campaignId],
    queryFn: () => getCampaign(organizationId, campaignId),
    refetchInterval: (query) => (query.state.data?.status === "SENDING" ? 5_000 : false),
  });
}

export function useCampaignAudience(organizationId: string, segment: CampaignSegment) {
  return useQuery({
    queryKey: [...root(organizationId), "audience", segment],
    queryFn: () => campaignAudience(organizationId, segment),
    placeholderData: keepPreviousData,
  });
}

export function useCampaignSegmentOptions(organizationId: string) {
  return useQuery({ queryKey: [...root(organizationId), "segment-options"], queryFn: () => campaignSegmentOptions(organizationId) });
}

export function useCreateCampaign(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (body: CampaignInput) => createCampaign(organizationId, body), onSuccess: invalidate });
}

export function useUpdateCampaign(organizationId: string, campaignId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (body: UpdateCampaignInput) => updateCampaign(organizationId, campaignId, body), onSuccess: invalidate });
}

export function useDeleteCampaign(organizationId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: (campaignId: string) => deleteCampaign(organizationId, campaignId), onSuccess: invalidate });
}

export function useSendCampaignTest(organizationId: string, campaignId: string) {
  return useMutation({ mutationFn: () => sendCampaignTest(organizationId, campaignId) });
}

export function useSendCampaign(organizationId: string, campaignId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: () => sendCampaign(organizationId, campaignId), onSuccess: invalidate });
}

export function useCancelCampaign(organizationId: string, campaignId: string) {
  const invalidate = useInvalidate(organizationId);
  return useMutation({ mutationFn: () => cancelCampaign(organizationId, campaignId), onSuccess: invalidate });
}
