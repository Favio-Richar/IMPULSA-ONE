import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteMediaAsset, getMediaLibrary } from "../api/media";

export function useMediaLibrary(organizationId: string) {
  return useQuery({ queryKey: ["media", organizationId], queryFn: () => getMediaLibrary(organizationId) });
}

export function useDeleteMediaAsset(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => deleteMediaAsset(organizationId, assetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["media", organizationId] });
      void queryClient.invalidateQueries({ queryKey: ["organization-plan", organizationId] });
    },
  });
}
