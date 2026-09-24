"use client";

import type { AdminOverviewResponse } from "@impulza/contracts";
import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@impulza/ui";
import { ChartColumn, Table2 } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatInteger } from "../lib/format";

// Mismos valores que `packages/ui/src/styles/tokens.css` y que el gráfico del panel (F3.7):
// literales porque Recharts los escribe como atributos SVG, donde `var(--...)` no siempre resuelve.
const CHART_COLORS = { series: "#0f6f6b", grid: "#dde5e3", axis: "#475569", cursor: "#f1f5f4" } as const;

type Point = AdminOverviewResponse["signups"][number];
type Metric = "organizations" | "users";
const METRIC_LABELS: Record<Metric, string> = { organizations: "Organizaciones", users: "Usuarios" };
const METRIC_SINGULAR: Record<Metric, string> = { organizations: "organización", users: "usuario" };

const shortDay = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const parseDay = (day: string) => new Date(`${day}T00:00:00Z`);

function ChartTooltip({ active, payload, metric }: { active?: boolean; payload?: Array<{ payload: Point }>; metric: Metric }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  const value = point[metric];
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm">
      <p className="text-muted-foreground">{longDay.format(parseDay(point.day))}</p>
      <p className="font-medium text-foreground">
        {formatInteger(value)} {value === 1 ? METRIC_SINGULAR[metric] : METRIC_LABELS[metric].toLowerCase()}
      </p>
    </div>
  );
}

/**
 * Altas por día (F4.4). Una serie a la vez, igual que el dashboard del panel: usuarios y
 * organizaciones se miden distinto y dos series en el mismo eje invitan a compararlas como si no.
 * Barras finas ancladas a la base, tooltip por barra y vista de tabla con los mismos datos.
 */
export function SignupsChart({ signups }: { signups: Point[] }): React.JSX.Element {
  const [metric, setMetric] = useState<Metric>("organizations");
  const [view, setView] = useState<"chart" | "table">("chart");
  const total = signups.reduce((sum, point) => sum + point[metric], 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Qué altas mostrar" className="inline-flex rounded-md border border-border p-0.5">
          {(Object.keys(METRIC_LABELS) as Metric[]).map((key) => (
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
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{formatInteger(total)}</span> en 30 días
          </p>
          <Button variant="ghost" size="sm" onClick={() => setView(view === "chart" ? "table" : "chart")} aria-pressed={view === "table"}>
            {view === "chart" ? <Table2 className="size-4" aria-hidden="true" /> : <ChartColumn className="size-4" aria-hidden="true" />}
            {view === "chart" ? "Ver como tabla" : "Ver gráfico"}
          </Button>
        </div>
      </div>

      {view === "table" ? (
        <div className="max-h-72 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead className="text-right">Organizaciones</TableHead>
                <TableHead className="text-right">Usuarios</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...signups].reverse().map((point) => (
                <TableRow key={point.day}>
                  <TableCell>{longDay.format(parseDay(point.day))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInteger(point.organizations)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInteger(point.users)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <figure className="m-0">
          <figcaption className="sr-only">
            {`Altas de ${METRIC_LABELS[metric].toLowerCase()} por día en los últimos 30 días: ${formatInteger(total)} en total. Usa "Ver como tabla" para leer cada día.`}
          </figcaption>
          <div className="h-56 w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signups} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} strokeWidth={1} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(day: string) => shortDay.format(parseDay(day))}
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
                  width={44}
                  domain={[0, total === 0 ? 4 : "auto"]}
                />
                <Tooltip cursor={{ fill: CHART_COLORS.cursor }} content={<ChartTooltip metric={metric} />} />
                <Bar dataKey={metric} fill={CHART_COLORS.series} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </figure>
      )}
    </div>
  );
}
