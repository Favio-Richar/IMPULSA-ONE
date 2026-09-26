"use client";

import type { MediaAssetResponse } from "@impulza/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { isVideoMimeType } from "@impulza/validation";
import { type UploadProgress, uploadMedia, UploadError } from "../../lib/upload-image";

export interface UploadItem {
  id: string;
  fileName: string;
  /** Video (PP6): el paso del servidor es convertirlo, no optimizarlo. */
  isVideo: boolean;
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
export function useImageUploads(
  organizationId: string,
  onUploaded?: (asset: MediaAssetResponse) => void,
  options: { allowVideo?: boolean } = {},
) {
  const allowVideo = options.allowVideo ?? false;
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
          isVideo: isVideoMimeType(file.type),
          progress: { phase: "validating" as const, percent: 0 },
          error: null,
          cause: null,
          asset: null,
        },
      }));
      setItems((current) => [...queued.map((entry) => entry.item), ...current]);

      for (const { file, item } of queued) {
        try {
          const asset = await uploadMedia(organizationId, file, (progress) => update(item.id, { progress }), { allowVideo });
          update(item.id, { asset });
          onUploaded?.(asset);
        } catch (error) {
          update(item.id, {
            error: error instanceof UploadError ? error.message : "No pudimos subir el archivo.",
            cause: error instanceof UploadError ? error.origin : error,
            progress: { phase: "failed", percent: 0 },
          });
        } finally {
          void queryClient.invalidateQueries({ queryKey: ["media", organizationId] });
          void queryClient.invalidateQueries({ queryKey: ["organization-plan", organizationId] });
        }
      }
    },
    [organizationId, onUploaded, queryClient, update, allowVideo],
  );

  const dismiss = useCallback((id: string) => setItems((current) => current.filter((item) => item.id !== id)), []);

  return { items, addFiles, dismiss };
}
