import type { BlockResponse } from "@impulza/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBlock,
  deleteBlock,
  duplicateBlock,
  listBlocks,
  reorderBlocks,
  setPrimaryBlock,
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

/**
 * PP5: actualización optimista — la marca cambia al instante en el lienzo, el interruptor y la vista
 * previa, y se revierte si el servidor la rechaza (p. ej. 409 porque otra persona la cambió a la
 * vez). La respuesta trae todos los bloques con el estado real y reemplaza la suposición.
 */
export function useSetPrimaryBlock(organizationId: string, siteId: string, pageId: string) {
  const queryClient = useQueryClient();
  const key = blocksKey(organizationId, siteId, pageId);
  return useMutation({
    mutationFn: (blockId: string | null) => setPrimaryBlock(organizationId, siteId, pageId, blockId),
    onMutate: async (blockId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BlockResponse[]>(key);
      queryClient.setQueryData<BlockResponse[]>(key, (blocks) =>
        blocks?.map((block) => ({ ...block, isPrimary: block.id === blockId })),
      );
      return { previous };
    },
    onError: (_error, _blockId, context) => {
      queryClient.setQueryData(key, context?.previous);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onSuccess: (blocks) => {
      queryClient.setQueryData(key, blocks);
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
