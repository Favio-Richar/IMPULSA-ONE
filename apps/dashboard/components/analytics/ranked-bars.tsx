import { formatInteger, formatPercent } from "./format";

export interface RankedBarItem {
  key: string;
  label: string;
  detail?: string | null;
  value: number;
}

/**
 * Ranking como barras horizontales (F3.7): magnitud en un solo tono (el primario de marca), la
 * barra nace siempre de la misma línea base y el valor va al final de la fila en tinta de texto,
 * nunca en el color del dato. Es HTML, no un gráfico: se lee con lector de pantalla como una
 * lista y cada fila lleva su valor escrito, así que no hace falta una vista de tabla aparte.
 */
export function RankedBars({
  items,
  total,
  emptyLabel,
}: {
  items: RankedBarItem[];
  /** Base del porcentaje de cada fila; por defecto, la suma de las filas. */
  total?: number;
  emptyLabel: string;
}): React.JSX.Element {
  if (items.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((item) => item.value), 1);
  const base = total ?? items.reduce((sum, item) => sum + item.value, 0);

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-foreground" title={item.detail ? `${item.label} · ${item.detail}` : item.label}>
              {item.label}
              {item.detail ? <span className="text-muted-foreground"> · {item.detail}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">
              {formatInteger(item.value)}
              {base > 0 ? <span className="ml-1 text-muted-foreground">({formatPercent(item.value / base)})</span> : null}
            </span>
          </div>
          <div className="h-2 w-full rounded-sm bg-surface" aria-hidden="true">
            <div
              className="h-2 rounded-r-sm bg-primary"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
