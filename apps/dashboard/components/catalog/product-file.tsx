"use client";

import type { ProductResponse } from "@impulza/contracts";
import { DOWNLOAD_MIME_TYPES, DOWNLOAD_TYPE_LABELS, MAX_DOWNLOAD_BYTES, MAX_DOWNLOADS_PER_ORDER } from "@impulza/validation";
import { Button } from "@impulza/ui";
import { useQueryClient } from "@tanstack/react-query";
import { FileDown, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { removeProductFile } from "../../lib/api/catalog";
import { uploadProductFile } from "../../lib/upload-product-file";
import { UploadError } from "../../lib/upload-image";
import { ConfirmButton } from "../confirm-button";

/** Tamaño legible: "1,2 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

const ACCEPTED = DOWNLOAD_MIME_TYPES.join(",");
const FORMATS = DOWNLOAD_MIME_TYPES.map((type) => DOWNLOAD_TYPE_LABELS[type]).join(", ");

/**
 * Archivo que se vende con un producto digital (F5.11b, ADR-015): el comprador lo descarga recién
 * cuando el pedido está pagado (Mercado Pago o marcado a mano). Subir uno nuevo reemplaza al anterior.
 */
export function ProductFile({ organizationId, siteId, product }: { organizationId: string; siteId: string; product: ProductResponse }): React.JSX.Element {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["catalog", organizationId, siteId] });
  const file = product.downloadFile;

  async function onPick(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    setError(null);
    setPercent(0);
    try {
      await uploadProductFile(organizationId, siteId, product.id, picked, setPercent);
      await refresh();
    } catch (caught) {
      setError(caught instanceof UploadError ? caught.message : "No pudimos subir el archivo. Intenta de nuevo.");
    } finally {
      setPercent(null);
    }
  }

  async function onRemove(): Promise<void> {
    setError(null);
    setRemoving(true);
    try {
      await removeProductFile(organizationId, siteId, product.id);
      await refresh();
    } catch {
      setError("No pudimos quitar el archivo. Intenta de nuevo.");
    } finally {
      setRemoving(false);
    }
  }

  const uploading = percent !== null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 sm:basis-full" data-product-file={product.name}>
      {/* En teléfono el nombre va en su propia línea (no apretado junto a los botones). */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="flex min-w-0 flex-1 items-start gap-2 text-sm">
          <FileDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {file ? (
            <span className="min-w-0 text-foreground">
              <span className="font-medium [overflow-wrap:anywhere]">{file.fileName}</span>
              <span className="text-muted-foreground"> · {formatFileSize(file.sizeBytes)} · se entrega al pagar</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Sin archivo: sube el que recibe el comprador al pagar.</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} id={inputId} type="file" accept={ACCEPTED} className="sr-only" onChange={(event) => void onPick(event)} disabled={uploading} />
        <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()} loading={uploading} aria-label={`${file ? "Reemplazar" : "Subir"} archivo de ${product.name}`}>
          <Upload className="size-4" aria-hidden="true" />
          {file ? "Reemplazar" : "Subir archivo"}
        </Button>
        {file ? (
          <ConfirmButton
            variant="ghost"
            size="sm"
            confirmLabel="¿Quitar? Nadie podrá descargarlo"
            loading={removing}
            onConfirm={() => void onRemove()}
            aria-label={`Quitar archivo de ${product.name}`}
          >
            Quitar
          </ConfirmButton>
        ) : null}
        </div>
      </div>
      {uploading ? (
        <div role="progressbar" aria-label={`Subiendo archivo de ${product.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {FORMATS}, hasta {MAX_DOWNLOAD_BYTES / 1024 / 1024} MB (cuenta para el almacenamiento de tu plan). Cada compra tiene {MAX_DOWNLOADS_PER_ORDER} descargas.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
