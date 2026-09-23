import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addContactNote,
  createContact,
  deleteContact,
  exportContact,
  getContact,
  listContacts,
  updateContact,
  type ContactFilters,
} from "../api/contacts";

// Mismo criterio que use-sites.ts (F2.9): `organizationId` en cada queryKey para que cambiar de
// organización activa invalide el caché de la anterior en vez de arrastrarlo.

export function useContacts(organizationId: string, filters: ContactFilters) {
  return useQuery({
    queryKey: ["contacts", organizationId, filters],
    queryFn: () => listContacts(organizationId, filters),
  });
}

export function useContact(organizationId: string, contactId: string) {
  return useQuery({
    queryKey: ["contacts", organizationId, contactId],
    queryFn: () => getContact(organizationId, contactId),
  });
}

export function useCreateContact(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; email?: string; phone?: string; tags?: string[] }) =>
      createContact(organizationId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contacts", organizationId] });
    },
  });
}

export function useUpdateContact(organizationId: string, contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Parameters<typeof updateContact>[2]) => updateContact(organizationId, contactId, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contacts", organizationId] });
    },
  });
}

export function useAddContactNote(organizationId: string, contactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => addContactNote(organizationId, contactId, note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contacts", organizationId] });
    },
  });
}

export function useDeleteContact(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) => deleteContact(organizationId, contactId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contacts", organizationId] });
    },
  });
}

export function useExportContact(organizationId: string) {
  return useMutation({
    mutationFn: (contactId: string) => exportContact(organizationId, contactId),
  });
}
