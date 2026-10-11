import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateWhiteLabelDto, UploadBrandingAssetDto } from "@impulza/validation";
import { getPanelBrand, getWhiteLabel, setClientWhiteLabel, updateWhiteLabel, uploadWhiteLabelAsset } from "../api/white-label";

const settingsKey = (organizationId: string) => ["white-label", organizationId] as const;

export function useWhiteLabel(organizationId: string) {
  return useQuery({ queryKey: settingsKey(organizationId), queryFn: () => getWhiteLabel(organizationId) });
}

export function useUpdateWhiteLabel(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateWhiteLabelDto) => updateWhiteLabel(organizationId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKey(organizationId), saved);
      // La marca de los clientes que la tienen activa cambió: se refresca lo que cada panel pregunta.
      void queryClient.invalidateQueries({ queryKey: ["panel-brand"] });
    },
  });
}

export function useUploadWhiteLabelAsset(organizationId: string) {
  return useMutation({ mutationFn: (body: UploadBrandingAssetDto) => uploadWhiteLabelAsset(organizationId, body) });
}

export function useSetClientWhiteLabel(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { relationId: string; enabled: boolean }) => setClientWhiteLabel(organizationId, input.relationId, input.enabled),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsKey(organizationId) }),
        queryClient.invalidateQueries({ queryKey: ["agency", organizationId] }),
        queryClient.invalidateQueries({ queryKey: ["panel-brand"] }),
      ]);
    },
  });
}

/** La marca con que se viste el panel de la organización activa (`brand: null` = la de la plataforma). */
export function usePanelBrand(organizationId: string | null) {
  return useQuery({
    queryKey: ["panel-brand", organizationId] as const,
    queryFn: () => getPanelBrand(organizationId!),
    enabled: organizationId !== null,
    staleTime: 60 * 1000,
    // Si falla, el panel sigue con la marca de la plataforma: la marca nunca debe romper la pantalla.
    retry: false,
  });
}
