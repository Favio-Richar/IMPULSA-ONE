import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createShortLink, deleteShortLink, listShortLinks, updateShortLink } from "../api/short-links";

export function useShortLinks(organizationId: string) {
  return useQuery({
    queryKey: ["short-links", organizationId],
    queryFn: () => listShortLinks(organizationId),
  });
}

export function useCreateShortLink(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { slug: string; destinationUrl: string }) => createShortLink(organizationId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["short-links", organizationId] });
    },
  });
}

export function useUpdateShortLink(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shortLinkId, changes }: { shortLinkId: string; changes: { destinationUrl?: string } }) =>
      updateShortLink(organizationId, shortLinkId, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["short-links", organizationId] });
    },
  });
}

export function useDeleteShortLink(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shortLinkId: string) => deleteShortLink(organizationId, shortLinkId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["short-links", organizationId] });
    },
  });
}
