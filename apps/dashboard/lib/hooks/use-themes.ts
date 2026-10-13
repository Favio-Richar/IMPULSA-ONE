import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteTheme, duplicateTheme, listThemes, updateTheme } from "../api/themes";

export function useThemes(organizationId: string) {
  return useQuery({
    queryKey: ["themes", organizationId],
    queryFn: () => listThemes(organizationId),
  });
}

export function useDuplicateTheme(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ themeId, name }: { themeId: string; name?: string }) => duplicateTheme(organizationId, themeId, name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["themes", organizationId] }),
  });
}

export function useUpdateTheme(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ themeId, name, tokens }: { themeId: string; name?: string; tokens?: unknown }) =>
      updateTheme(organizationId, themeId, { ...(name === undefined ? {} : { name }), ...(tokens === undefined ? {} : { tokens }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["themes", organizationId] });
      // Los sitios que usan el tema lo ven con los tokens nuevos: se refresca el tema efectivo de cada uno.
      void queryClient.invalidateQueries({ queryKey: ["sites", organizationId] });
    },
  });
}

export function useDeleteTheme(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (themeId: string) => deleteTheme(organizationId, themeId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["themes", organizationId] }),
  });
}
