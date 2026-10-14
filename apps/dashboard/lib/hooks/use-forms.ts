import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addFormField,
  createForm,
  deleteForm,
  deleteFormField,
  listForms,
  listFormSubmissions,
  updateForm,
  updateFormField,
  type CreateFormFieldBody,
  type UpdateFormBody,
} from "../api/forms";

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
    mutationFn: (body: { name: string; type?: "CONTACT" | "QUOTE" | "REGISTRATION" | "SURVEY" | "ORDER"; fields?: CreateFormFieldBody[] }) => createForm(organizationId, siteId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formsKey(organizationId, siteId) });
    },
  });
}

export function useUpdateForm(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ formId, body }: { formId: string; body: UpdateFormBody }) => updateForm(organizationId, siteId, formId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formsKey(organizationId, siteId) });
    },
  });
}

export function useDeleteForm(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formId: string) => deleteForm(organizationId, siteId, formId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formsKey(organizationId, siteId) });
    },
  });
}

export function useFormFieldActions(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: formsKey(organizationId, siteId) });
  const add = useMutation({
    mutationFn: ({ formId, body }: { formId: string; body: CreateFormFieldBody }) => addFormField(organizationId, siteId, formId, body),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ formId, fieldId, body }: { formId: string; fieldId: string; body: Parameters<typeof updateFormField>[4] }) =>
      updateFormField(organizationId, siteId, formId, fieldId, body),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: ({ formId, fieldId }: { formId: string; fieldId: string }) => deleteFormField(organizationId, siteId, formId, fieldId),
    onSuccess: refresh,
  });
  return { add, update, remove };
}

export function useFormSubmissions(organizationId: string, siteId: string, formId: string, offset: number, limit = 25) {
  return useQuery({
    queryKey: ["form-submissions", organizationId, siteId, formId, offset, limit] as const,
    queryFn: () => listFormSubmissions(organizationId, siteId, formId, { limit, offset }),
    enabled: formId !== "",
  });
}
