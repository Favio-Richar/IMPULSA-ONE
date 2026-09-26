"use client";

import type { MediaAssetResponse } from "@impulza/contracts";
import { Button, Dialog, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { useCallback, useState } from "react";
import { useMediaLibrary } from "../../lib/hooks/use-media";
import { MediaGrid } from "./media-grid";
import { UploadDropzone } from "./upload-dropzone";
import { UploadList } from "./upload-list";
import { useImageUploads } from "./use-image-uploads";

/**
 * Elegir una imagen de la biblioteca o subir una en el momento (PP2). Una imagen recién subida
 * queda elegida sola: el camino más común es "subo mi logo y lo uso", en un solo paso.
 */
export function MediaPicker({
  organizationId,
  open,
  onOpenChange,
  onSelect,
  hint,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: MediaAssetResponse) => void;
  /** Guía de proporción para este lugar (p. ej. "Cuadrada, al menos 400 × 400 px"). */
  hint?: string;
}): React.JSX.Element {
  const libraryQuery = useMediaLibrary(organizationId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const handleUploaded = useCallback((asset: MediaAssetResponse) => setSelectedId(asset.id), []);
  const uploads = useImageUploads(organizationId, handleUploaded);

  // Solo imágenes: los videos de la biblioteca (PP6) son para el fondo de la página, no para un bloque.
  const images = (libraryQuery.data?.items ?? []).filter((item) => item.kind === "IMAGE");
  const selected = images.find((item) => item.id === selectedId && item.status === "READY") ?? null;
  const configured = libraryQuery.data?.storageConfigured ?? true;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Elegir imagen"
      description={hint ? `Recomendado: ${hint}.` : "De tu biblioteca, o sube una nueva."}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (selected) {
                onSelect(selected);
                onOpenChange(false);
              }
            }}
          >
            Usar imagen
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {configured ? (
          <>
            <UploadDropzone compact multiple={false} onFiles={(files) => void uploads.addFiles(files)} />
            <UploadList items={uploads.items} onDismiss={uploads.dismiss} />
          </>
        ) : (
          <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
            La subida de imágenes todavía no está habilitada. Mientras tanto puedes usar un enlace externo.
          </p>
        )}

        {libraryQuery.isPending ? (
          <LoadingState label="Cargando tu biblioteca…" />
        ) : libraryQuery.isError ? (
          <ErrorState onRetry={() => libraryQuery.refetch()} />
        ) : images.length === 0 ? (
          <EmptyState title="Tu biblioteca está vacía" description="Las imágenes que subas quedan aquí para usarlas en cualquier página." />
        ) : (
          <MediaGrid items={images} selectedId={selectedId} onSelect={(asset) => setSelectedId(asset.id)} />
        )}
      </div>
    </Dialog>
  );
}
