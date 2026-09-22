import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createForm, listForms, type CreateFormFieldBody } from "../api/forms";

function formsKey(organizationId: string, siteId: string) {
  return ["forms", organizationId, siteId] as const;
}

export function useForms(organizationId: string, siteId: string) {
  return useQuery({
    queryKey: formsKey(organizationId, siteId),
    queryFn: () => listForms(organizationId, siteId),
  });
}

export function useCreateForm(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; fields?: CreateFormFieldBody[] }) => createForm(organizationId, siteId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formsKey(organizationId, siteId) });
    },
  });
}
