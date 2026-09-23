import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createQrCode, deleteQrCode, listQrCodes } from "../api/qr-codes";

export function useQrCodes(organizationId: string) {
  return useQuery({
    queryKey: ["qr-codes", organizationId],
    queryFn: () => listQrCodes(organizationId),
  });
}

export function useCreateQrCode(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { shortLinkId?: string; directUrl?: string; styleKey: string }) =>
      createQrCode(organizationId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["qr-codes", organizationId] });
    },
  });
}

export function useDeleteQrCode(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (qrCodeId: string) => deleteQrCode(organizationId, qrCodeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["qr-codes", organizationId] });
    },
  });
}
