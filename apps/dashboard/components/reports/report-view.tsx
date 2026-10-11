"use client";

import type { ReportMetricResponse, ReportResponse } from "@impulza/contracts";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { getReport, getReportCsv } from "../../lib/api/reports";
import { ShareLinks } from "./share-links";

const number = new Intl.NumberFormat("es-CL");
const percent = new Intl.NumberFormat("es-CL", { style: "percent", maximumFractionDigits: 1 });

function isoDay(offset: number): string {
  return new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

const PRESETS = [
  { label: "Últimos 7 días", from: () => isoDay(-6), to: () => isoDay(0) },
  { label: "Últimos 30 días", from: () => isoDay(-29), to: () => isoDay(0) },
  { label: "Últimos 90 días", from: () => isoDay(-89), to: () => isoDay(0) },
];

function dayText(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("es-CL", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}

function saveCsv(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function valueText(metric: ReportMetricResponse, currency: string | null): string {
  if (metric.key === "revenue") {
    return currency ? new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: 0 }).format(metric.value) : number.format(metric.value);
  }
  return number.format(metric.value);
}

/** La variación como texto y tono: sin base no se inventa nada («—»); con base 0 se dice «nuevo». */
function DeltaCell({ delta, available }: { delta: ReportMetricResponse["previous"]; available: boolean }): React.JSX.Element {
  if (!available || delta.base === null) return <span className="text-muted-foreground">No disponible</span>;
  if (delta.change === null) return <span className="text-muted-foreground">—</span>;
  const sign = delta.change > 0 ? "+" : "";
  const tone = delta.change > 0 ? "text-success" : delta.change < 0 ? "text-danger" : "text-muted-foreground";
  return (
    <span className="flex flex-col">
      <span className={tone}>
        {delta.ratio === null ? (delta.base === 0 && delta.change > 0 ? "Nuevo" : "0 %") : `${sign}${percent.format(delta.ratio)}`}
      </span>
      <span className="text-xs text-muted-foreground">
        antes {number.format(delta.base)} ({sign}
        {number.format(delta.change)})
      </span>
    </span>
  );
}

/**
 * Informe del cliente (F9.8a): periodo elegible, cada métrica contra el periodo anterior y el mismo periodo del año anterior, conversión,
 * ranking de bloques y serie diaria. Se descarga como CSV y se imprime (la hoja de estilos de impresión oculta la navegación).
 */
export function ReportView({ organizationId }: { organizationId: string }): React.JSX.Element {
  const [from, setFrom] = useState(PRESETS[1]!.from());
  const [to, setTo] = useState(PRESETS[1]!.to());
  const [applied, setApplied] = useState({ from, to });
  const query = useQuery({ queryKey: ["report", organizationId, applied.from, applied.to], queryFn: () => getReport(organizationId, applied.from, applied.to) });
  const csv = useMutation({ mutationFn: () => getReportCsv(organizationId, applied.from, applied.to), onSuccess: (text) => saveCsv(`informe-${applied.from}-${applied.to}.csv`, text) });

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setApplied({ from, to });
  };

  return (
    <div className="flex flex-col gap-6" data-testid="report">
      <form onSubmit={apply} className="flex flex-col gap-3 print:hidden" aria-label="Periodo del informe">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const next = { from: preset.from(), to: preset.to() };
                setFrom(next.from);
                setTo(next.to);
                setApplied(next);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Input label="Desde" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input label="Hasta" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <Button type="submit">Ver informe</Button>
        </div>
      </form>

      {query.isPending ? (
        <LoadingState label="Calculando el informe…" />
      ) : query.isError ? (
        query.error instanceof ApiError && query.error.status === 402 ? (
          <EmptyState title="Ese periodo es más largo que el historial de tu plan" description="Elige un periodo más reciente o sube de plan para ver más historia." />
        ) : query.error instanceof ApiError && query.error.status === 400 ? (
          <p role="alert" className="text-sm text-danger">
            Revisa las fechas: el periodo debe ir de menor a mayor y no pasar de 366 días.
          </p>
        ) : (
          <ErrorState onRetry={() => void query.refetch()} />
        )
      ) : (
        <>
          <ReportBody report={query.data} onCsv={() => csv.mutate()} csvLoading={csv.isPending} csvError={csv.isError} />
          <ShareLinks organizationId={organizationId} from={applied.from} to={applied.to} />
        </>
      )}
    </div>
  );
}

function ReportBody({ report, onCsv, csvLoading, csvError }: { report: ReportResponse; onCsv: () => void; csvLoading: boolean; csvError: boolean }): React.JSX.Element {
  const maxViews = Math.max(1, ...report.series.map((point) => point.pageViews));
  const empty = report.metrics.every((metric) => metric.value === 0);
  return (
    <>
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">{report.organizationName}</h2>
        <p className="text-sm text-muted-foreground">
          {dayText(report.period.from)} a {dayText(report.period.to)} · vs. {dayText(report.previousPeriod.from)} a {dayText(report.previousPeriod.to)} y vs.{" "}
          {dayText(report.lastYearPeriod.from)} a {dayText(report.lastYearPeriod.to)}
        </p>
        <div className="flex flex-wrap gap-2 pt-2 print:hidden">
          <Button type="button" size="sm" variant="secondary" loading={csvLoading} onClick={onCsv}>
            Descargar CSV
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Imprimir
          </Button>
        </div>
        {csvError ? (
          <p role="alert" className="text-sm text-danger">
            No pudimos descargar el CSV. Intenta de nuevo.
          </p>
        ) : null}
      </header>

      {empty ? <EmptyState title="Sin actividad en este periodo" description="Cuando tu página reciba visitas, contactos o pedidos, aparecerán aquí." /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Resumen</CardTitle>
          <CardDescription>Cada cifra comparada con el periodo anterior y con el mismo periodo del año anterior.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm" data-testid="report-metrics">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Métrica</th>
                <th className="py-2 pr-3 text-right font-medium">Periodo</th>
                <th className="py-2 pr-3 font-medium">vs. periodo anterior</th>
                <th className="py-2 font-medium">vs. año anterior</th>
              </tr>
            </thead>
            <tbody>
              {report.metrics.map((metric) => (
                <tr key={metric.key} className="border-b border-border last:border-0" data-metric={metric.key}>
                  <td className="py-2 pr-3 text-foreground">{metric.label}</td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums text-foreground">{valueText(metric, report.currency)}</td>
                  <td className="py-2 pr-3">
                    <DeltaCell delta={metric.previous} available={report.comparison.previousAvailable} />
                  </td>
                  <td className="py-2">
                    <DeltaCell delta={metric.lastYear} available={report.comparison.lastYearAvailable} />
                  </td>
                </tr>
              ))}
              <tr data-metric="conversion">
                <td className="py-2 pr-3 text-foreground">Conversión (contactos / visitantes)</td>
                <td className="py-2 pr-3 text-right font-medium tabular-nums text-foreground">
                  {report.conversion.value === null ? "—" : percent.format(report.conversion.value)}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{report.conversion.previous === null ? "—" : percent.format(report.conversion.previous)}</td>
                <td className="py-2 text-muted-foreground">{report.conversion.lastYear === null ? "—" : percent.format(report.conversion.lastYear)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Visitas por día</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-28 items-end gap-0.5" role="img" aria-label={`Visitas por día entre ${report.period.from} y ${report.period.to}`}>
            {report.series.map((point) => (
              <div
                key={point.date}
                className="min-w-[2px] flex-1 rounded-t bg-primary/70"
                style={{ height: `${Math.max(2, (point.pageViews / maxViews) * 100)}%` }}
                title={`${point.date}: ${number.format(point.pageViews)}`}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bloques con más clics</CardTitle>
        </CardHeader>
        <CardContent>
          {report.topBlocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin clics en bloques en este periodo.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {report.topBlocks.map((block) => (
                <li key={block.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-foreground">
                    {block.label ?? block.kind ?? "Bloque eliminado"}
                    {block.detail ? <span className="text-muted-foreground"> · {block.detail}</span> : null}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{number.format(block.value)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <p className="hidden text-xs text-muted-foreground print:block">Generado el {new Date(report.generatedAt).toLocaleString("es-CL")}.</p>
    </>
  );
}
