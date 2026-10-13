"use client";

import type { PlanResponse } from "@impulza/contracts";
import { Gauge } from "lucide-react";
import Link from "next/link";
import { siteUsage } from "../../lib/site-card";

/** El siguiente plan (por orden del catálogo) que da más sitios que el actual, o `null`. */
export function nextPlanWithMoreSites(catalog: readonly PlanResponse[] | undefined, current: PlanResponse): PlanResponse | null {
  if (!catalog) return null;
  const currentLimit = current.limits.sites;
  if (currentLimit === null) return null;
  return (
    [...catalog]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .find((plan) => plan.sortOrder > current.sortOrder && (plan.limits.sites === null || plan.limits.sites > currentLimit)) ?? null
  );
}

/**
 * «X de Y sitios usados» con barra de progreso (o «ilimitados»). Cuando se llega al límite lo dice con claridad y lleva a los planes:
 * el usuario tiene permiso, lo que falta es cupo.
 */
export function SitesPlanUsage({
  used,
  limit,
  planName,
  nextPlan,
}: {
  used: number;
  limit: number | null;
  planName: string;
  nextPlan: PlanResponse | null;
}): React.JSX.Element {
  const usage = siteUsage(used, limit);
  const percent = usage.ratio === null ? 0 : Math.round(usage.ratio * 100);

  return (
    <section aria-label="Uso del plan" className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
          {limit === null ? (
            <span>
              {used} {used === 1 ? "sitio" : "sitios"} · <span className="text-muted-foreground">ilimitados en tu plan {planName}</span>
            </span>
          ) : (
            <span>
              <span className="tabular-nums">{used}</span> de <span className="tabular-nums">{limit}</span> {limit === 1 ? "sitio usado" : "sitios usados"}{" "}
              <span className="font-normal text-muted-foreground">· plan {planName}</span>
            </span>
          )}
        </p>
        <Link href="/plan" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
          Ver planes
        </Link>
      </div>
      {usage.ratio !== null ? (
        <div
          role="progressbar"
          aria-label="Sitios usados"
          aria-valuemin={0}
          aria-valuemax={usage.limit ?? undefined}
          aria-valuenow={Math.min(usage.used, usage.limit ?? usage.used)}
          aria-valuetext={`${usage.used} de ${usage.limit} sitios`}
          className="h-2 w-full overflow-hidden rounded-full bg-surface-hover"
        >
          <div className={usage.reached ? "h-full bg-warning" : "h-full bg-primary"} style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {usage.reached ? (
        <p className="text-sm text-muted-foreground">
          Llegaste al límite de sitios de tu plan.{" "}
          {nextPlan ? (
            <>
              Sube a <span className="font-medium text-foreground">{nextPlan.name}</span> para crear más.
            </>
          ) : (
            "Cambia de plan para crear más."
          )}
        </p>
      ) : null}
    </section>
  );
}
