"use client";

import { Button, cn } from "@impulza/ui";
import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from "@impulza/validation";
import { ImageUp } from "lucide-react";
import { useRef, useState } from "react";

/**
 * Zona para soltar imágenes, con botón (el arrastre no es accesible por teclado ni existe en el
 * teléfono: el botón es la vía principal, el arrastre un atajo). Solo los formatos permitidos.
 */
export function UploadDropzone({
  onFiles,
  disabled,
  compact = false,
  multiple = true,
  allowVideo = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  multiple?: boolean;
  /** Biblioteca con ffmpeg configurado (PP6): también acepta video para el fondo de la página. */
  allowVideo?: boolean;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(list: FileList | null): void {
    if (!list || list.length === 0 || disabled) {
      return;
    }
    onFiles(multiple ? Array.from(list) : [list[0]!]);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        take(event.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center transition-colors",
        compact ? "px-4 py-5" : "px-6 py-10",
        dragging ? "border-primary bg-primary/5" : "border-border-strong bg-surface/40",
        disabled && "opacity-60",
      )}
    >
      <ImageUp className="size-6 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          {compact ? "Sube una imagen nueva" : allowVideo ? "Arrastra tus imágenes o videos aquí" : "Arrastra tus imágenes aquí"}
        </p>
        <p className="text-xs text-muted-foreground">JPG, PNG, WebP o AVIF · hasta 8 MB. Las optimizamos y quitamos la ubicación de la foto.</p>
        {allowVideo ? (
          <p className="text-xs text-muted-foreground">
            Video para el fondo: MP4, WebM o MOV · hasta 30 MB y 15 segundos. Lo dejamos listo para cualquier teléfono, sin sonido.
          </p>
        ) : null}
      </div>
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Elegir {multiple ? "archivos" : "archivo"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={[...IMAGE_MIME_TYPES, ...(allowVideo ? VIDEO_MIME_TYPES : [])].join(",")}
        multiple={multiple}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
