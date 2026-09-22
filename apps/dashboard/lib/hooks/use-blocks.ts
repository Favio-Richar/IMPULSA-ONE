import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBlock,
  deleteBlock,
  duplicateBlock,
  listBlocks,
  reorderBlocks,
  updateBlock,
} from "../api/blocks";

function blocksKey(organizationId: string, siteId: string, pageId: string) {
  return ["blocks", organizationId, siteId, pageId] as const;
}

export function useBlocks(organizationId: string, siteId: string, pageId: string) {
  return useQuery({
    queryKey: blocksKey(organizationId, siteId, pageId),
    queryFn: () => listBlocks(organizationId, siteId, pageId),
  });
}

export function useCreateBlock(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { type: string; config: unknown; visible?: boolean }) =>
      createBlock(organizationId, siteId, pageId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: blocksKey(organizationId, siteId, pageId) });
    },
  });
}

export function useUpdateBlock(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ blockId, changes }: { blockId: string; changes: { config?: unknown; visible?: boolean } }) =>
      updateBlock(organizationId, siteId, pageId, blockId, changes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: blocksKey(organizationId, siteId, pageId) });
    },
  });
}

export function useReorderBlocks(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockIds: string[]) => reorderBlocks(organizationId, siteId, pageId, blockIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: blocksKey(organizationId, siteId, pageId) });
    },
  });
}

export function useDuplicateBlock(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockId: string) => duplicateBlock(organizationId, siteId, pageId, blockId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: blocksKey(organizationId, siteId, pageId) });
    },
  });
}

export function useDeleteBlock(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockId: string) => deleteBlock(organizationId, siteId, pageId, blockId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: blocksKey(organizationId, siteId, pageId) });
    },
  });
}
