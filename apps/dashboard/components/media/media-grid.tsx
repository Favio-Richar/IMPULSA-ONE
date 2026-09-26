"use client";

import type { MediaAssetResponse } from "@impulza/contracts";
import { cn } from "@impulza/ui";
import { Check, CircleAlert, Loader2, Play } from "lucide-react";

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Miniatura: la variante más chica basta para una grilla. */
function thumbnail(asset: MediaAssetResponse): string | null {
  return asset.variants[0]?.url ?? asset.url;
}

/**
 * Grilla de la biblioteca. Con `onSelect` es un grupo de opciones (radio) para elegir una imagen;
 * sin él, solo muestra. `renderActions` agrega acciones por imagen (p. ej. borrar).
 */
export function MediaGrid({
  items,
  selectedId,
  onSelect,
  renderActions,
}: {
  items: MediaAssetResponse[];
  selectedId?: string | null;
  onSelect?: (asset: MediaAssetResponse) => void;
  renderActions?: (asset: MediaAssetResponse) => React.ReactNode;
}): React.JSX.Element {
  return (
    <ul
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      role={onSelect ? "radiogroup" : undefined}
      aria-label={onSelect ? "Imágenes de tu biblioteca" : undefined}
    >
      {items.map((asset) => {
        const selectable = Boolean(onSelect) && asset.status === "READY";
        const selected = selectable && selectedId === asset.id;
        const src = thumbnail(asset);
        const preview = (
          <div className={cn("relative aspect-square overflow-hidden rounded-md border bg-surface", selected ? "border-primary ring-2 ring-primary" : "border-border")}>
            {asset.status === "READY" && src ? (
              // Miniatura: la variante de 400 px que ya generó el worker, no hace falta next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-2 text-center text-xs text-muted-foreground">
                {asset.status === "FAILED" ? (
                  <>
                    <CircleAlert className="size-5 text-danger" aria-hidden="true" />
                    <span className="text-danger">{asset.failureReason ?? "No se pudo procesar"}</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                    {asset.kind === "VIDEO" ? "Convirtiendo…" : "Optimizando…"}
                  </>
                )}
              </div>
            )}
            {asset.kind === "VIDEO" ? (
              // La miniatura de un video es su póster: la marca dice que es un video, no una foto.
              <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-sm bg-foreground/80 px-1.5 py-0.5 text-xs font-medium text-background">
                <Play className="size-3" aria-hidden="true" />
                Video
              </span>
            ) : null}
            {selected ? (
              <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <Check className="size-4" aria-hidden="true" />
              </span>
            ) : null}
          </div>
        );
        const caption = (
          <div className="flex min-w-0 flex-col text-left">
            <span className="truncate text-xs font-medium text-foreground">{asset.fileName}</span>
            <span className="text-xs text-muted-foreground">
              {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
              {formatSize(asset.sizeBytes)}
            </span>
          </div>
        );

        return (
          <li key={asset.id} className="flex min-w-0 flex-col gap-1.5">
            {onSelect ? (
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={asset.kind === "VIDEO" ? `${asset.fileName} (video)` : asset.fileName}
                disabled={!selectable}
                onClick={() => onSelect(asset)}
                className="flex flex-col gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-not-allowed"
              >
                {preview}
                {caption}
              </button>
            ) : (
              <>
                {preview}
                {caption}
              </>
            )}
            {renderActions ? renderActions(asset) : null}
          </li>
        );
      })}
    </ul>
  );
}
