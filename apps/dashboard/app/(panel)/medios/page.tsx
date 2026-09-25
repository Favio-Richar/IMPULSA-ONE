"use client";

import { Button, EmptyState, ErrorState, LoadingState, cn } from "@impulza/ui";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { MediaGrid } from "../../../components/media/media-grid";
import { UploadDropzone } from "../../../components/media/upload-dropzone";
import { UploadList } from "../../../components/media/upload-list";
import { useImageUploads } from "../../../components/media/use-image-uploads";
import { ApiError } from "../../../lib/api-client";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { useDeleteMediaAsset, useMediaLibrary } from "../../../lib/hooks/use-media";

export default function MediosPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver su biblioteca." />;
  }
  return <MediaLibrary organizationId={activeOrganizationId} />;
}

/** Menos de 1 MB se muestra en KB: "0 MB" con fotos ya subidas confunde. */
function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024).toLocaleString("es-CL")} KB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString("es-CL", { maximumFractionDigits: 1 })} MB`;
}

function MediaLibrary({ organizationId }: { organizationId: string }): React.JSX.Element {
  const libraryQuery = useMediaLibrary(organizationId);
  const uploads = useImageUploads(organizationId);
  const deleteMutation = useDeleteMediaAsset(organizationId);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ assetId: string; message: string } | null>(null);

  async function remove(assetId: string): Promise<void> {
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(assetId);
      setConfirmingId(null);
    } catch (error) {
      const body = error instanceof ApiError ? (error.body as { code?: string; usages?: Array<{ siteName: string; pageSlug: string }> }) : undefined;
      const message =
        body?.code === "MEDIA_IN_USE" && body.usages
          ? `Se usa en: ${body.usages.map((usage) => `${usage.siteName} /${usage.pageSlug}`).join(", ")}. Quítala de ahí primero.`
          : "No pudimos borrar la imagen. Intenta de nuevo.";
      setDeleteError({ assetId, message });
      setConfirmingId(null);
    }
  }

  const usage = libraryQuery.data?.usage;
  const ratio = usage && usage.limitBytes ? usage.usedBytes / usage.limitBytes : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">Medios</h1>
          <p className="text-sm text-muted-foreground">Tus fotos y logos, listos para usar en cualquier página. Los optimizamos para que carguen rápido en el celular.</p>
        </div>
        {usage ? (
          <div className="flex min-w-56 flex-col gap-1.5 text-sm" aria-label="Uso de almacenamiento">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Almacenamiento</span>
              <span className="tabular-nums text-foreground">
                {formatBytes(usage.usedBytes)}
                {usage.limitBytes ? ` de ${formatBytes(usage.limitBytes)}` : ""}
              </span>
            </div>
            {usage.limitBytes ? (
              <div
                role="meter"
                aria-label="Almacenamiento usado"
                aria-valuemin={0}
                aria-valuemax={usage.limitBytes}
                aria-valuenow={Math.min(usage.usedBytes, usage.limitBytes)}
                className={cn("h-2 w-full rounded-sm", ratio >= 0.9 ? "bg-danger/15" : "bg-primary/15")}
              >
                <div className={cn("h-2 rounded-sm", ratio >= 0.9 ? "bg-danger" : "bg-primary")} style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
              </div>
            ) : null}
            {ratio >= 0.9 ? (
              <Link href="/plan" className="text-xs font-medium text-primary hover:underline">
                Casi sin espacio: ver planes
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {libraryQuery.data && !libraryQuery.data.storageConfigured ? (
        <p className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-foreground">
          La subida de imágenes todavía no está habilitada en esta instalación. Estará disponible apenas se configure el almacenamiento.
        </p>
      ) : (
        <>
          <UploadDropzone onFiles={(files) => void uploads.addFiles(files)} />
          <UploadList items={uploads.items} onDismiss={uploads.dismiss} />
        </>
      )}

      {libraryQuery.isPending ? (
        <LoadingState label="Cargando tu biblioteca…" />
      ) : libraryQuery.isError ? (
        <ErrorState onRetry={() => libraryQuery.refetch()} />
      ) : libraryQuery.data.items.length === 0 ? (
        <EmptyState title="Todavía no subes imágenes" description="Sube tu logo, una foto de portada o fotos de tus productos." />
      ) : (
        <MediaGrid
          items={libraryQuery.data.items}
          renderActions={(asset) => (
            <div className="flex flex-col gap-1">
              {confirmingId === asset.id ? (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-foreground">¿Borrar?</span>
                  <Button type="button" variant="secondary" size="sm" className="h-7 px-2" onClick={() => setConfirmingId(null)}>
                    No
                  </Button>
                  <Button type="button" variant="destructive" size="sm" className="h-7 px-2" loading={deleteMutation.isPending} onClick={() => void remove(asset.id)}>
                    Sí
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="ghost" size="sm" className="h-7 w-fit px-2 text-muted-foreground" onClick={() => setConfirmingId(asset.id)}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Borrar
                </Button>
              )}
              {deleteError?.assetId === asset.id ? (
                <p role="alert" className="text-xs text-danger">
                  {deleteError.message}
                </p>
              ) : null}
            </div>
          )}
        />
      )}
    </div>
  );
}
