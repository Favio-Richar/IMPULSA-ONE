"use client";

import type { FunnelReportResponse } from "@impulza/contracts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@impulza/ui";
import { AlertTriangle, ArrowDown } from "lucide-react";
import { formatInteger, formatPercent } from "../analytics/format";

/** "45 s", "4 min", "2 h 5 min", "3 d 4 h": la mediana entre pasos, legible de un vistazo. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  if (seconds < 60) {
    return `${Math.max(Math.round(seconds), 0)} s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} d ${restHours} h` : `${days} d`;
}

function percentOrDash(value: number | null): string {
  return value === null ? "—" : formatPercent(value);
}

/**
 * Embudo dibujado paso a paso (F7.6): una barra por paso en un solo tono (el primario de marca),
 * proporcional al primer paso, y entre pasos cuántas visitas avanzan, cuántas abandonan y en cuánto
 * tiempo. El paso con más abandono se destaca con ícono y texto, no solo con color (WCAG 1.4.1).
 * Es HTML: un lector de pantalla lo recorre como una lista ordenada; la tabla de abajo da los mismos
 * números en columnas.
 */
export function FunnelChart({ report }: { report: FunnelReportResponse }): React.JSX.Element {
  const first = report.steps[0]?.visitors ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col" aria-label="Pasos del embudo">
        {report.steps.map((step, index) => {
          const worst = report.biggestDropOffStep === index;
          const width = first > 0 ? Math.max((step.visitors / first) * 100, step.visitors > 0 ? 2 : 0) : 0;
          return (
            <li key={index} className="flex flex-col" data-funnel-step={index}>
              {index > 0 ? (
                <div
                  className={cn(
                    "my-1 ml-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 py-2 pl-5 text-xs",
                    worst ? "border-warning text-foreground" : "border-border text-muted-foreground",
                  )}
                  data-funnel-dropoff={index}
                >
                  <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-medium text-foreground">{percentOrDash(step.conversionFromPrevious)}</span> avanza
                  </span>
                  <span>
                    {formatInteger(step.dropOff)} {step.dropOff === 1 ? "abandona" : "abandonan"} ({percentOrDash(step.dropOffRate)})
                  </span>
                  <span>mediana {formatDuration(step.medianSecondsFromPrevious)}</span>
                  {worst ? (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-warning/10 px-1.5 py-0.5 font-medium text-warning">
                      <AlertTriangle className="size-3.5" aria-hidden="true" />
                      Mayor abandono
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-2 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-foreground">
                      {index + 1}
                    </span>
                    <span className="truncate font-medium text-foreground">{step.label}</span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-foreground">
                    {formatInteger(step.visitors)}
                    {index > 0 && step.conversionFromStart !== null ? (
                      <span className="ml-1 text-muted-foreground">({formatPercent(step.conversionFromStart)} del inicio)</span>
                    ) : null}
                  </span>
                </div>
                <div className="h-3 w-full rounded-sm bg-surface" aria-hidden="true">
                  <div className="h-3 rounded-r-sm bg-primary transition-[width]" style={{ width: `${width}%` }} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">Ver como tabla</summary>
        <div className="overflow-x-auto border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paso</TableHead>
                <TableHead className="text-right">Visitas</TableHead>
                <TableHead className="text-right">Desde el anterior</TableHead>
                <TableHead className="text-right">Desde el inicio</TableHead>
                <TableHead className="text-right">Abandonan</TableHead>
                <TableHead className="text-right">Mediana</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.steps.map((step, index) => (
                <TableRow key={index}>
                  <TableCell>
                    {index + 1}. {step.label}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatInteger(step.visitors)}</TableCell>
                  <TableCell className="text-right tabular-nums">{percentOrDash(step.conversionFromPrevious)}</TableCell>
                  <TableCell className="text-right tabular-nums">{index === 0 ? "—" : percentOrDash(step.conversionFromStart)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {index === 0 ? "—" : `${formatInteger(step.dropOff)} (${percentOrDash(step.dropOffRate)})`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{index === 0 ? "—" : formatDuration(step.medianSecondsFromPrevious)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  );
}
