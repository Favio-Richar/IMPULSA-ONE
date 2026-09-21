import type { SeoMeta } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPage,
  deletePage,
  getPage,
  listPageVersions,
  listPages,
  publishPage,
  reorderPages,
  restorePage,
  restorePageVersion,
  updatePage,
} from "../api/pages";

function pagesKey(organizationId: string, siteId: string) {
  return ["pages", organizationId, siteId] as const;
}

function pageKey(organizationId: string, siteId: string, pageId: string) {
  return ["pages", organizationId, siteId, pageId] as const;
}

function versionsKey(organizationId: string, siteId: string, pageId: string) {
  return ["pages", organizationId, siteId, pageId, "versions"] as const;
}

export function usePages(organizationId: string, siteId: string) {
  return useQuery({
    queryKey: pagesKey(organizationId, siteId),
    queryFn: () => listPages(organizationId, siteId),
  });
}

export function usePage(organizationId: string, siteId: string, pageId: string) {
  return useQuery({
    queryKey: pageKey(organizationId, siteId, pageId),
    queryFn: () => getPage(organizationId, siteId, pageId),
  });
}

export function useCreatePage(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, visibility }: { slug: string; visibility?: "PUBLIC" | "HIDDEN" }) =>
      createPage(organizationId, siteId, slug, visibility),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pagesKey(organizationId, siteId) });
    },
  });
}

/** Manda el orden completo (mismo criterio que la API, F2.3): el llamador arma la lista de ids ya
 *  reordenada, este hook no calcula posiciones. */
export function useReorderPages(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pageIds: string[]) => reorderPages(organizationId, siteId, pageIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pagesKey(organizationId, siteId) });
    },
  });
}

export function useUpdatePage(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: { slug?: string; visibility?: "PUBLIC" | "HIDDEN"; seoMeta?: SeoMeta | null }) =>
      updatePage(organizationId, siteId, pageId, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pagesKey(organizationId, siteId) });
      void queryClient.invalidateQueries({ queryKey: pageKey(organizationId, siteId, pageId) });
    },
  });
}

export function useDeletePage(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => deletePage(organizationId, siteId, pageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pagesKey(organizationId, siteId) });
    },
  });
}

export function useRestorePage(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => restorePage(organizationId, siteId, pageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pagesKey(organizationId, siteId) });
    },
  });
}

export function usePublishPage(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => publishPage(organizationId, siteId, pageId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pageKey(organizationId, siteId, pageId) });
      void queryClient.invalidateQueries({ queryKey: versionsKey(organizationId, siteId, pageId) });
    },
  });
}

export function usePageVersions(organizationId: string, siteId: string, pageId: string) {
  return useQuery({
    queryKey: versionsKey(organizationId, siteId, pageId),
    queryFn: () => listPageVersions(organizationId, siteId, pageId),
  });
}

export function useRestorePageVersion(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => restorePageVersion(organizationId, siteId, pageId, versionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pageKey(organizationId, siteId, pageId) });
      void queryClient.invalidateQueries({ queryKey: versionsKey(organizationId, siteId, pageId) });
      void queryClient.invalidateQueries({ queryKey: pagesKey(organizationId, siteId) });
    },
  });
}
