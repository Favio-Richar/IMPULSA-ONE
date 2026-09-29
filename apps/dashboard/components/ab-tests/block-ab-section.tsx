"use client";

import { Button } from "@impulza/ui";
import type { AbTestBlockType } from "@impulza/validation";
import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatRate, verdictSummary } from "../../lib/ab-test-messages";
import { useAbTests } from "../../lib/hooks/use-ab-tests";
import { NewAbTestDialog } from "./new-ab-test-dialog";

/**
 * Prueba A/B del bloque en el constructor (F6.5): si hay una en curso, su estado en una línea y el
 * acceso a los resultados; si no, el botón para empezar una. Los resultados completos y "Aplicar"
 * viven en la pantalla de pruebas del sitio.
 */
export function BlockAbSection({
  organizationId,
  siteId,
  blockId,
  blockType,
  blockLabel,
  currentConfig,
}: {
  organizationId: string;
  siteId: string;
  blockId: string;
  blockType: AbTestBlockType;
  blockLabel: string;
  currentConfig: Record<string, unknown>;
}): React.JSX.Element | null {
  const tests = useAbTests(organizationId, siteId);
  const [open, setOpen] = useState(false);

  if (tests.isPending || tests.isError) {
    // Opcional para editar el bloque: sin la lista, la sección simplemente no aparece.
    return null;
  }
  const running = tests.data.find((test) => test.blockId === blockId && test.status === "RUNNING");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FlaskConical className="size-4 text-primary" aria-hidden="true" />
        Prueba A/B
      </p>
      {running ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-foreground">
            En curso: <span className="font-medium">{running.name}</span>
          </p>
          <p className="text-sm tabular-nums text-muted-foreground">
            A {formatRate(running.results.rateA)} · B {formatRate(running.results.rateB)} de clics por visita — {verdictSummary(running.results).title.toLowerCase()}
          </p>
          <Link href={`/sitios/${siteId}/pruebas`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            Ver resultados
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Compara otro texto o estilo con tus visitantes reales antes de decidir.</p>
          <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
            <FlaskConical className="size-4" aria-hidden="true" />
            Probar una variante
          </Button>
          {open ? (
            <NewAbTestDialog
              open
              onOpenChange={setOpen}
              organizationId={organizationId}
              siteId={siteId}
              blockId={blockId}
              blockType={blockType}
              blockLabel={blockLabel}
              currentConfig={currentConfig}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
