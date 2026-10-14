import type { ApplyTemplateResponse } from "@impulza/contracts";
import type { ApplyTemplateInput } from "@impulza/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applyTemplate } from "../api/templates";

/**
 * Aplica una plantilla a una página desde el panel (misma operación que usa el asistente: `POST .../apply-template`).
 * Refresca los bloques de la página y el sitio para que el constructor muestre lo aplicado.
 */
export function useApplyTemplate(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    ApplyTemplateResponse,
    Error,
    { siteId: string; pageId: string; input: Partial<ApplyTemplateInput> & { templateCode: string } }
  >({
    mutationFn: ({ siteId, pageId, input }) => applyTemplate(organizationId, siteId, pageId, input),
    onSuccess: (_result, { siteId, pageId }) => {
      void queryClient.invalidateQueries({ queryKey: ["blocks", organizationId, siteId, pageId] });
      void queryClient.invalidateQueries({ queryKey: ["sites", organizationId, siteId] });
    },
  });
}
