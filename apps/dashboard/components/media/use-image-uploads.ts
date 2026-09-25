"use client";

import type { MediaAssetResponse } from "@impulza/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { type UploadProgress, uploadImage, UploadError } from "../../lib/upload-image";

export interface UploadItem {
  id: string;
  fileName: string;
  progress: UploadProgress;
  error: string | null;
  /** Causa original (p. ej. el 402 de límite de plan) para mostrar el aviso correcto. */
  cause: unknown;
  asset: MediaAssetResponse | null;
}

/**
 * Cola de subidas de la biblioteca de medios. Sube de a una a propósito: con varias fotos grandes en
 * una conexión móvil, subir en paralelo solo hace que todas tarden más y compitan con la página.
 */
export function useImageUploads(organizationId: string, onUploaded?: (asset: MediaAssetResponse) => void) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const queued = files.map((file) => ({
        file,
        item: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fileName: file.name,
          progress: { phase: "validating" as const, percent: 0 },
          error: null,
          cause: null,
          asset: null,
        },
      }));
      setItems((current) => [...queued.map((entry) => entry.item), ...current]);

      for (const { file, item } of queued) {
        try {
          const asset = await uploadImage(organizationId, file, (progress) => update(item.id, { progress }));
          update(item.id, { asset });
          onUploaded?.(asset);
        } catch (error) {
          update(item.id, {
            error: error instanceof UploadError ? error.message : "No pudimos subir la imagen.",
            cause: error instanceof UploadError ? error.origin : error,
            progress: { phase: "failed", percent: 0 },
          });
        } finally {
          void queryClient.invalidateQueries({ queryKey: ["media", organizationId] });
          void queryClient.invalidateQueries({ queryKey: ["organization-plan", organizationId] });
        }
      }
    },
    [organizationId, onUploaded, queryClient, update],
  );

  const dismiss = useCallback((id: string) => setItems((current) => current.filter((item) => item.id !== id)), []);

  return { items, addFiles, dismiss };
}
