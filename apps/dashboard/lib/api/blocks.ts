import type { BlockResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

function blocksPath(organizationId: string, siteId: string, pageId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/pages/${pageId}/blocks`;
}

export function listBlocks(organizationId: string, siteId: string, pageId: string): Promise<BlockResponse[]> {
  return apiFetch<BlockResponse[]>(blocksPath(organizationId, siteId, pageId));
}

export function createBlock(
  organizationId: string,
  siteId: string,
  pageId: string,
  body: { type: string; config: unknown; visible?: boolean; scheduledStart?: string; scheduledEnd?: string },
): Promise<BlockResponse> {
  return apiFetch<BlockResponse>(blocksPath(organizationId, siteId, pageId), { method: "POST", body });
}

export function updateBlock(
  organizationId: string,
  siteId: string,
  pageId: string,
  blockId: string,
  changes: { config?: unknown; visible?: boolean; scheduledStart?: string | null; scheduledEnd?: string | null },
): Promise<BlockResponse> {
  return apiFetch<BlockResponse>(`${blocksPath(organizationId, siteId, pageId)}/${blockId}`, {
    method: "PATCH",
    body: changes,
  });
}

/** Manda el orden completo, no un movimiento relativo (mismo criterio que páginas, F2.3/F2.4). */
export function reorderBlocks(
  organizationId: string,
  siteId: string,
  pageId: string,
  blockIds: string[],
): Promise<BlockResponse[]> {
  return apiFetch<BlockResponse[]>(`${blocksPath(organizationId, siteId, pageId)}/reorder`, {
    method: "PUT",
    body: { blockIds },
  });
}

export function duplicateBlock(
  organizationId: string,
  siteId: string,
  pageId: string,
  blockId: string,
): Promise<BlockResponse> {
  return apiFetch<BlockResponse>(`${blocksPath(organizationId, siteId, pageId)}/${blockId}/duplicate`, {
    method: "POST",
  });
}

/** Borrado físico, sin papelera propia (F2.4) — a diferencia de páginas, no hay `restore`. */
export function deleteBlock(
  organizationId: string,
  siteId: string,
  pageId: string,
  blockId: string,
): Promise<void> {
  return apiFetch<void>(`${blocksPath(organizationId, siteId, pageId)}/${blockId}`, { method: "DELETE" });
}
