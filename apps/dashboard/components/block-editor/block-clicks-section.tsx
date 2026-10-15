"use client";

import type { BlockType } from "@impulza/validation";
import { MousePointerClick } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { useBlockClicks } from "../../lib/hooks/use-analytics";

/** Bloques sin enlaces posibles: un clic ahí nunca se mide, así que no se muestra la sección (sería un 0 engañoso). */
const NOT_CLICKABLE: ReadonlySet<BlockType> = new Set(["divider", "sticker"]);

export function blockHasClicks(type: BlockType): boolean {
  return !NOT_CLICKABLE.has(type);
}

const NUMBER = new Intl.NumberFormat("es");
const DAY = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Clics del bloque (solo lectura) en el panel del constructor: el total de los últimos 30 días y un gráfico mínimo por día. Sale
 * de los mismos agregados que el ranking de bloques de Estadísticas. El gráfico es decorativo: su contenido va en texto para
 * lectores de pantalla (el total, y el mejor día si lo hubo).
 */
export function BlockClicksSection({ organizationId, blockId }: { organizationId: string; blockId: string }): React.JSX.Element {
  const query = useBlockClicks(organizationId, blockId);
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="block-clicks">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={titleId} className="flex items-center gap-2 text-sm font-medium text-foreground">
          <MousePointerClick className="size-4 text-muted-foreground" aria-hidden="true" />
          Clics
        </h3>
        <span className="text-xs text-muted-foreground">{query.data ? `Últimos ${query.data.days} días` : "Últimos 30 días"}</span>
      </div>

      {query.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Cargando los clics del bloque…</span>
          <span aria-hidden="true" className="h-7 w-16 animate-pulse rounded-md bg-surface motion-reduce:animate-none" />
          <span aria-hidden="true" className="h-8 w-full animate-pulse rounded-md bg-surface motion-reduce:animate-none" />
        </div>
      ) : query.isError ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          No pudimos cargar los clics.
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        </p>
      ) : (
        <ClicksBody data={query.data} />
      )}
    </section>
  );
}

function ClicksBody({ data }: { data: NonNullable<ReturnType<typeof useBlockClicks>["data"]> }): React.JSX.Element {
  const max = Math.max(...data.series.map((point) => point.clicks), 0);
  // El día más reciente con el máximo (si hay empate, el último).
  const best = max > 0 ? [...data.series].reverse().find((point) => point.clicks === max) : undefined;

  return (
    <>
      <p className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{NUMBER.format(data.total)}</span>
        <span className="text-sm text-muted-foreground">{data.total === 1 ? "clic" : "clics"}</span>
      </p>
      {data.total === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía nadie hizo clic en este bloque. Se cuentan los clics de la página publicada.</p>
      ) : (
        <>
          {/* Una barra por día; los días sin clics quedan como una línea base tenue para que la escala de tiempo se lea. */}
          <div aria-hidden="true" className="flex h-10 items-end gap-px" data-testid="block-clicks-chart">
            {data.series.map((point) => (
              <span
                key={point.date}
                title={`${DAY.format(new Date(`${point.date}T00:00:00Z`))}: ${point.clicks}`}
                className={point.clicks > 0 ? "flex-1 rounded-t-[2px] bg-primary" : "flex-1 bg-border"}
                style={{ height: point.clicks > 0 ? `${Math.max(12, (point.clicks / max) * 100)}%` : "2px" }}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {best ? `Mejor día: ${DAY.format(new Date(`${best.date}T00:00:00Z`))} (${NUMBER.format(best.clicks)}).` : null}{" "}
            <Link href="/analitica" className="font-medium text-primary underline-offset-2 hover:underline">
              Ver estadísticas
            </Link>
          </p>
        </>
      )}
    </>
  );
}
