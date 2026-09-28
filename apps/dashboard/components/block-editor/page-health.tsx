"use client";

import type { PageHealthFindingResponse, PageHealthResponse } from "@impulza/contracts";
import { Button, Dialog, cn } from "@impulza/ui";
import { isBlockType } from "@impulza/validation";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BLOCK_LABELS } from "../../lib/block-fields/labels";
import { healthMessage, scoreLabel } from "../../lib/page-health-messages";

const TONE_RING: Record<ReturnType<typeof scoreLabel>["tone"], string> = {
  good: "border-success bg-success/10",
  fair: "border-warning bg-warning/10",
  poor: "border-danger bg-danger/10",
};

const SEVERITY: Record<PageHealthFindingResponse["severity"], { label: string; icon: typeof Info; className: string }> = {
  critical: { label: "Importante", icon: AlertOctagon, className: "text-danger" },
  warning: { label: "Conviene corregir", icon: AlertTriangle, className: "text-warning" },
  info: { label: "Sugerencias", icon: Info, className: "text-muted-foreground" },
};

interface PageHealthProps {
  siteId: string;
  pageId: string;
  health: { data: PageHealthResponse | undefined; isPending: boolean; isError: boolean; isFetching: boolean; refetch: () => void };
  onOpenBlock: (blockId: string) => void;
  onPublish: () => void;
  publishing: boolean;
}

/**
 * Salud de la página (F6.1): un indicador compacto en la cabecera del constructor (el puntaje y su
 * lectura) que abre el detalle con cada hallazgo y un botón que lleva a corregirlo. El puntaje lo
 * calcula el servidor; acá solo se pinta.
 */
export function PageHealth({ siteId, pageId, health, onOpenBlock, onPublish, publishing }: PageHealthProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  if (health.isPending) {
    return (
      <span className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm text-muted-foreground" aria-live="polite">
        <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
        Revisando la página…
      </span>
    );
  }

  if (health.isError || !health.data) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => health.refetch()}>
        <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
        No pudimos revisar la página · Reintentar
      </Button>
    );
  }

  const { score, findings } = health.data;
  const { label, tone } = scoreLabel(score);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm text-foreground hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        aria-label={`Salud de la página: ${score} de 100, ${label}. Ver detalle`}
      >
        <span className={cn("inline-flex size-6 items-center justify-center rounded-full border-2 text-xs font-semibold tabular-nums", TONE_RING[tone])}>
          {score}
        </span>
        <span>Salud: {label}</span>
        {health.isFetching ? <RefreshCw className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
      </button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Salud de la página"
        description="Revisamos publicación, contenido, acciones, SEO, accesibilidad, enlaces y peso de la página."
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <span
              className={cn("inline-flex size-16 shrink-0 items-center justify-center rounded-full border-4 text-xl font-semibold tabular-nums text-foreground", TONE_RING[tone])}
              aria-hidden="true"
            >
              {score}
            </span>
            <div>
              <p className="text-base font-semibold text-foreground">
                {score} de 100 · {label}
              </p>
              <p className="text-sm text-muted-foreground">
                {findings.length === 0
                  ? "No encontramos nada que corregir."
                  : `${findings.length} ${findings.length === 1 ? "punto por revisar" : "puntos por revisar"}.`}
              </p>
            </div>
          </div>

          {findings.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-3 text-sm text-foreground">
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
              Tu página está en buena forma: publicada, con una acción clara y lista para buscadores.
            </p>
          ) : (
            (["critical", "warning", "info"] as const).map((severity) => {
              const group = findings.filter((finding) => finding.severity === severity);
              if (group.length === 0) {
                return null;
              }
              const { label: groupLabel, icon: Icon, className } = SEVERITY[severity];
              return (
                <section key={severity} aria-label={groupLabel} className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Icon className={cn("size-4", className)} aria-hidden="true" />
                    {groupLabel} ({group.length})
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {group.map((finding, index) => (
                      <FindingRow
                        key={`${finding.code}-${finding.blockId ?? index}`}
                        finding={finding}
                        siteId={siteId}
                        pageId={pageId}
                        publishing={publishing}
                        onOpenBlock={(blockId) => {
                          setOpen(false);
                          onOpenBlock(blockId);
                        }}
                        onPublish={onPublish}
                        onClose={() => setOpen(false)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </Dialog>
    </>
  );
}

function FindingRow({
  finding,
  siteId,
  pageId,
  publishing,
  onOpenBlock,
  onPublish,
  onClose,
}: {
  finding: PageHealthFindingResponse;
  siteId: string;
  pageId: string;
  publishing: boolean;
  onOpenBlock: (blockId: string) => void;
  onPublish: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const message = healthMessage(finding.code);
  const blockLabel = finding.blockType && isBlockType(finding.blockType) ? BLOCK_LABELS[finding.blockType] : undefined;

  let action: React.ReactNode = null;
  if (message.fix === "block" && finding.blockId) {
    const blockId = finding.blockId;
    action = (
      <Button type="button" size="sm" variant="secondary" onClick={() => onOpenBlock(blockId)}>
        Abrir el bloque
      </Button>
    );
  } else if (message.fix === "publish") {
    action = (
      <Button type="button" size="sm" loading={publishing} onClick={onPublish}>
        Publicar
      </Button>
    );
  } else if (message.fix === "seo") {
    action = (
      <Button asChild size="sm" variant="secondary">
        <Link href={`/sitios/${siteId}/paginas/${pageId}#seo`}>Editar SEO</Link>
      </Button>
    );
  } else if (message.fix === "theme") {
    action = (
      <Button asChild size="sm" variant="secondary">
        <Link href={`/sitios/${siteId}`}>Cambiar tema</Link>
      </Button>
    );
  } else if (message.fix === "add_block") {
    action = (
      <Button type="button" size="sm" variant="secondary" onClick={onClose}>
        Ir a la biblioteca
      </Button>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {message.title}
          {finding.count && finding.count > 1 && finding.code === "image_alt_missing" ? ` (${finding.count})` : ""}
        </p>
        <p className="text-sm text-muted-foreground">
          {blockLabel ? <span className="font-medium text-foreground">{blockLabel}: </span> : null}
          {message.detail}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}
