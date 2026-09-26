"use client";

import { Button, cn } from "@impulza/ui";
import { CheckCircle2, CircleAlert, Loader2, X } from "lucide-react";
import { PlanLimitNotice } from "../plan-limit-notice";
import type { UploadItem } from "./use-image-uploads";

const PHASE_TEXT: Record<UploadItem["progress"]["phase"], string> = {
  validating: "Revisando…",
  uploading: "Subiendo",
  verifying: "Verificando el archivo…",
  processing: "Optimizando…",
  ready: "Lista",
  failed: "No se pudo subir",
};

/** Estado de cada subida en curso: progreso real mientras sube, y luego cada paso del servidor. */
export function UploadList({ items, onDismiss }: { items: UploadItem[]; onDismiss: (id: string) => void }): React.JSX.Element | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Subidas" aria-live="polite">
      {items.map((item) => {
        const { phase, percent } = item.progress;
        const busy = phase !== "ready" && phase !== "failed";
        return (
          <li key={item.id} className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
            <div className="flex items-center gap-3 text-sm">
              {busy ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : phase === "ready" ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{item.fileName}</span>
              <span className={cn("shrink-0 text-xs", phase === "failed" ? "text-danger" : "text-muted-foreground")}>
                {phase === "processing" && item.isVideo ? "Convirtiendo el video…" : PHASE_TEXT[phase]}
                {phase === "uploading" ? ` ${percent} %` : ""}
              </span>
              {!busy ? (
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => onDismiss(item.id)} aria-label={`Quitar ${item.fileName} de la lista`}>
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
            {phase === "uploading" ? (
              <div
                role="progressbar"
                aria-label={`Subiendo ${item.fileName}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-1.5 w-full rounded-sm bg-primary/15"
              >
                <div className="h-1.5 rounded-sm bg-primary transition-[width]" style={{ width: `${percent}%` }} />
              </div>
            ) : null}
            {item.error ? (
              isPlanLimit(item.cause) ? (
                <PlanLimitNotice error={item.cause} />
              ) : (
                <p className="text-xs text-danger">{item.error}</p>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function isPlanLimit(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "status" in cause && (cause as { status: number }).status === 402;
}
