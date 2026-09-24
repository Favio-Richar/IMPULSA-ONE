"use client";

import type { AnalyticsSeriesPoint } from "@impulza/contracts";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@impulza/ui";
import { ChartLine, Table2 } from "lucide-react";
import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatInteger, formatLongDay, formatShortDay } from "./format";

// Colores del gráfico: los mismos valores que `packages/ui/src/styles/tokens.css`
// (--color-primary, --color-border, --color-muted-foreground). Van literales y no como
// `var(--...)` porque Recharts los escribe como atributos de presentación SVG (`stroke="..."`),
// donde una variable CSS no se resuelve en todos los navegadores.
const CHART_COLORS = {
  series: "#0f6f6b",
  grid: "#dde5e3",
  axis: "#475569",
  surface: "#ffffff",
} as const;

export type SeriesMetric = "pageViews" | "visitors" | "clicks" | "leads";

const METRIC_LABELS: Record<SeriesMetric, string> = {
  pageViews: "Visitas",
  visitors: "Visitantes",
  clicks: "Clics",
  leads: "Leads",
};

function ChartTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ payload: AnalyticsSeriesPoint }>;
  metric: SeriesMetric;
}): React.JSX.Element | null {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm">
      <p className="text-muted-foreground">{formatLongDay(point.date)}</p>
      <p className="font-medium text-foreground">
        {formatInteger(point[metric])} {METRIC_LABELS[metric].toLowerCase()}
      </p>
    </div>
  );
}

/**
 * Serie diaria del dashboard (F3.7). **Una sola serie a la vez**, elegida con el selector de
 * arriba: visitas y leads difieren en órdenes de magnitud, y dos escalas en el mismo gráfico (o un
 * segundo eje) engañan. Una serie no necesita leyenda — el selector activo ya dice qué se ve.
 * Línea de 2px, relleno al ~10 %, grilla de un pelo, cruz + tooltip al pasar, y una vista de tabla
 * con los mismos datos para quien no puede o no quiere leer el gráfico.
 */
export function SeriesChart({ series }: { series: AnalyticsSeriesPoint[] }): React.JSX.Element {
  const [metric, setMetric] = useState<SeriesMetric>("pageViews");
  const [view, setView] = useState<"chart" | "table">("chart");
  // Sin los caracteres especiales de `useId` (":" o "«»"): dentro de `url(#...)` en SVG rompen la
  // referencia al degradado en algunos navegadores.
  const gradientId = `serie-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const allZero = series.every((point) => point[metric] === 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Métrica del gráfico" className="inline-flex rounded-md border border-border p-0.5">
          {(Object.keys(METRIC_LABELS) as SeriesMetric[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={metric === key}
              onClick={() => setMetric(key)}
              className={cn(
                "rounded-sm px-3 py-1 text-sm transition-colors",
                metric === key ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface",
              )}
            >
              {METRIC_LABELS[key]}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
          aria-pressed={view === "table"}
        >
          {view === "chart" ? <Table2 className="size-4" aria-hidden="true" /> : <ChartLine className="size-4" aria-hidden="true" />}
          {view === "chart" ? "Ver como tabla" : "Ver gráfico"}
        </Button>
      </div>

      {view === "table" ? (
        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                {(Object.keys(METRIC_LABELS) as SeriesMetric[]).map((key) => (
                  <TableHead key={key} className="text-right">
                    {METRIC_LABELS[key]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {series.map((point) => (
                <TableRow key={point.date}>
                  <TableCell>{formatLongDay(point.date)}</TableCell>
                  {(Object.keys(METRIC_LABELS) as SeriesMetric[]).map((key) => (
                    <TableCell key={key} className="text-right tabular-nums">
                      {formatInteger(point[key])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <figure className="relative m-0">
          <figcaption className="sr-only">
            {METRIC_LABELS[metric]} por día, del {formatLongDay(series[0]?.date ?? "")} al{" "}
            {formatLongDay(series.at(-1)?.date ?? "")}. Usa &quot;Ver como tabla&quot; para leer cada valor.
          </figcaption>
          <div className="h-64 w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.series} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={CHART_COLORS.series} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} strokeWidth={1} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDay}
                  tick={{ fill: CHART_COLORS.axis, fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: CHART_COLORS.grid }}
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  tickFormatter={formatInteger}
                  tick={{ fill: CHART_COLORS.axis, fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  domain={[0, allZero ? 4 : "auto"]}
                />
                <Tooltip
                  cursor={{ stroke: CHART_COLORS.axis, strokeWidth: 1 }}
                  content={<ChartTooltip metric={metric} />}
                />
                <Area
                  // Recta entre días, no curva suavizada: una curva inventa valores entre un día y
                  // otro (y sobrepasa en los saltos desde cero) que los datos diarios no tienen.
                  type="linear"
                  dataKey={metric}
                  stroke={CHART_COLORS.series}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill={`url(#${gradientId})`}
                  dot={false}
                  activeDot={{ r: 4, fill: CHART_COLORS.series, stroke: CHART_COLORS.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </figure>
      )}
    </div>
  );
}
