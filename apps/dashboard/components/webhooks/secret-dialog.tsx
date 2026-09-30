"use client";

import { Button, Dialog } from "@impulza/ui";
import { KeyRound, TriangleAlert } from "lucide-react";
import { CopyButton } from "./copy-button";

/**
 * El secreto de firma se muestra **una sola vez** (ADR-017): al crear el destino o al rotarlo. Cerrar
 * el diálogo lo olvida; si se pierde, se rota.
 */
export function SecretDialog({ secret, rotated, onClose }: { secret: string; rotated: boolean; onClose: () => void }): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={rotated ? "Secreto nuevo" : "Destino creado"}
      description="Guarda el secreto de firma ahora: con él tu sistema comprueba que cada aviso viene de Impulza."
      footer={
        <Button type="button" onClick={onClose}>
          Ya lo guardé
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 text-sm font-medium text-foreground" id="secret-label">
            <KeyRound className="size-4 text-primary" aria-hidden="true" />
            Secreto de firma
          </span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              aria-labelledby="secret-label"
              data-testid="webhook-secret"
              className="min-w-0 flex-1 break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground select-all"
            >
              {secret}
            </code>
            <CopyButton value={secret} className="shrink-0" />
          </div>
        </div>
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            No lo volverás a ver. Si lo pierdes, rota el secreto desde el destino.
            {rotated ? " El anterior ya dejó de valer: actualízalo donde verificas la firma." : null}
          </span>
        </p>
      </div>
    </Dialog>
  );
}
