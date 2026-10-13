"use client";

import type { AnalyticsSeriesPoint } from "@impulza/contracts";
import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { CHART_COLORS } from "./series-chart";

/**
 * Cuántos días de la serie tienen visitas. Con menos de 2 no hay tendencia que dibujar: una línea
 * plana en cero se vería como un error, no como un dato.
 */
export function hasTrend(series: readonly AnalyticsSeriesPoint[] | undefined): boolean {
  return (series ?? []).filter((point) => point.pageViews > 0).length >= 2;
}

/**
 * Curva de tendencia mínima de visitas por día para una tarjeta del inicio. Mismo patrón y mismos
 * colores que `SeriesChart` (Recharts, línea recta entre días, relleno suave), sin ejes, grilla ni
 * tooltip: es decorativa, el número de la tarjeta es el dato. Va oculta a lectores de pantalla.
 */
export function Sparkline({ series }: { series: readonly AnalyticsSeriesPoint[] }): React.JSX.Element | null {
  // Sin los caracteres especiales de `useId`, que rompen `url(#...)` en SVG (ver `SeriesChart`).
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!hasTrend(series)) {
    return null;
  }
  return (
    <div className="h-10 w-full" aria-hidden="true" data-testid="visits-sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...series]} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.series} stopOpacity={0.18} />
              <stop offset="100%" stopColor={CHART_COLORS.series} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, "auto"]} />
          <Area
            type="linear"
            dataKey="pageViews"
            stroke={CHART_COLORS.series}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
