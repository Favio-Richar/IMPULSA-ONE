"use client";

import type { BlockResponse } from "@impulza/contracts";
import { Star } from "lucide-react";
import { useState } from "react";
import { useBlocks, useSetPrimaryBlock } from "../../lib/hooks/use-blocks";

/**
 * Interruptor "Acción principal" (PP5) en el panel de un bloque de acción (WhatsApp, enlace,
 * formulario). La regla "una por página" la aplica el servidor; acá solo se avisa que marcar este
 * reemplaza a la actual. Como todo cambio del constructor, se ve en el sitio al publicar.
 */
export function PrimaryActionToggle({
  organizationId,
  siteId,
  pageId,
  block,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  block: BlockResponse;
}) {
  const blocksQuery = useBlocks(organizationId, siteId, pageId);
  const mutation = useSetPrimaryBlock(organizationId, siteId, pageId);
  const replacesAnother = (blocksQuery.data ?? []).some((other) => other.isPrimary && other.id !== block.id);
  const inputId = `accion-principal-${block.id}`;
  // Valor elegido mientras el servidor confirma. Estado local y no solo la caché optimista: React
  // restaura un input controlado al terminar el evento de clic, y la caché se actualiza un tick
  // después — sin esto, la casilla "rebota" un instante antes de quedar marcada.
  const [pending, setPending] = useState<boolean | null>(null);
  const checked = pending ?? block.isPrimary;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-start gap-3">
        <input
          id={inputId}
          type="checkbox"
          className="mt-0.5 size-4 rounded border-border-strong"
          checked={checked}
          disabled={mutation.isPending}
          aria-describedby={`${inputId}-ayuda`}
          onChange={(event) => {
            const next = event.target.checked;
            setPending(next);
            mutation.mutate(next ? block.id : null, { onSettled: () => setPending(null) });
          }}
        />
        <div className="flex flex-col gap-0.5">
          <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Star className="size-4 text-primary" aria-hidden="true" />
            Acción principal
          </label>
          <p id={`${inputId}-ayuda`} className="text-sm text-muted-foreground">
            Se destaca y, en el teléfono, queda fija abajo mientras la persona recorre tu página.
            {replacesAnother && !checked ? " Reemplaza a la acción principal actual." : ""}
          </p>
        </div>
      </div>
      {mutation.isPending ? <p className="text-sm text-muted-foreground">Guardando…</p> : null}
      {mutation.isError ? (
        <p role="alert" className="text-sm text-danger">
          No pudimos cambiar la acción principal. Intenta de nuevo.
        </p>
      ) : null}
    </div>
  );
}
