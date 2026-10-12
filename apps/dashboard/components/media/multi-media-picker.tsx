"use client";

import type { MediaAssetResponse } from "@impulza/contracts";
import { Button, cn, Dialog, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { Check } from "lucide-react";
import { useCallback, useState } from "react";
import { useMediaLibrary } from "../../lib/hooks/use-media";
import { UploadDropzone } from "./upload-dropzone";
import { UploadList } from "./upload-list";
import { useImageUploads } from "./use-image-uploads";

/**
 * Elegir varias imágenes de la biblioteca (o subir varias en el momento) para agregarlas de una vez a un álbum o
 * galería. Cada foto recién subida queda marcada sola, así «subo 20 fotos y las agrego» es un solo paso.
 */
export function MultiMediaPicker({
  organizationId,
  open,
  onOpenChange,
  onConfirm,
  maxSelectable,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (assets: MediaAssetResponse[]) => void;
  /** Cuántas más caben en el bloque (el tope menos las que ya tiene). */
  maxSelectable: number;
}): React.JSX.Element {
  const libraryQuery = useMediaLibrary(organizationId);
  const [selected, setSelected] = useState<string[]>([]);
  const handleUploaded = useCallback(
    (asset: MediaAssetResponse) => setSelected((current) => (current.includes(asset.id) || current.length >= maxSelectable ? current : [...current, asset.id])),
    [maxSelectable],
  );
  const uploads = useImageUploads(organizationId, handleUploaded);

  // Al cerrar (cancelar o confirmar) la selección parte de cero la próxima vez.
  function changeOpen(next: boolean): void {
    if (!next) setSelected([]);
    onOpenChange(next);
  }

  const images = (libraryQuery.data?.items ?? []).filter((item) => item.kind === "IMAGE");
  const chosen = selected.map((id) => images.find((item) => item.id === id && item.status === "READY")).filter((item): item is MediaAssetResponse => item !== undefined);
  const configured = libraryQuery.data?.storageConfigured ?? true;

  function toggle(asset: MediaAssetResponse): void {
    setSelected((current) => {
      if (current.includes(asset.id)) return current.filter((id) => id !== asset.id);
      return current.length >= maxSelectable ? current : [...current, asset.id];
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
      size="lg"
      title="Agregar varias fotos"
      description={`Elige las que quieras de tu biblioteca o sube nuevas. Caben ${maxSelectable} más.`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => changeOpen(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => {
              onConfirm(chosen);
              changeOpen(false);
            }}
          >
            {chosen.length === 0 ? "Agregar fotos" : `Agregar ${chosen.length} ${chosen.length === 1 ? "foto" : "fotos"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {configured ? (
          <>
            <UploadDropzone compact multiple onFiles={(files) => void uploads.addFiles(files)} />
            <UploadList items={uploads.items} onDismiss={uploads.dismiss} />
          </>
        ) : (
          <p className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">La subida de imágenes todavía no está habilitada.</p>
        )}

        {libraryQuery.isPending ? (
          <LoadingState label="Cargando tu biblioteca…" />
        ) : libraryQuery.isError ? (
          <ErrorState onRetry={() => libraryQuery.refetch()} />
        ) : images.length === 0 ? (
          <EmptyState title="Tu biblioteca está vacía" description="Las imágenes que subas quedan aquí para usarlas en cualquier página." />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Imágenes de tu biblioteca">
            {images.map((asset) => {
              const ready = asset.status === "READY";
              const isSelected = selected.includes(asset.id);
              const src = asset.variants[0]?.url ?? asset.url;
              return (
                <li key={asset.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={asset.fileName}
                    disabled={!ready}
                    onClick={() => toggle(asset)}
                    className={cn(
                      "relative block aspect-square w-full overflow-hidden rounded-md border bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-60",
                      isSelected ? "border-primary ring-2 ring-primary" : "border-border",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {ready && src ? <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">Procesando…</span>}
                    {isSelected ? (
                      <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                        <Check className="size-4" aria-hidden="true" />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
