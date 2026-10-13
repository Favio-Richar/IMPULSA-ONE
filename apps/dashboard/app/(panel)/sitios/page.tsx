"use client";

import { Button, EmptyState, ErrorState, Select } from "@impulza/ui";
import { useQueries } from "@tanstack/react-query";
import { LayoutTemplate, PlusCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { GuardedAction } from "../../../components/sites/guarded-action";
import { SiteCard, type SiteVisits } from "../../../components/sites/site-card";
import { nextPlanWithMoreSites, SitesPlanUsage } from "../../../components/sites/sites-plan-usage";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { getAnalyticsOverview } from "../../../lib/api/analytics";
import { useOrganizationPlan, usePlanCatalog } from "../../../lib/hooks/use-plans";
import { useSites } from "../../../lib/hooks/use-sites";
import { isSiteSortKey, SITE_SORT_OPTIONS, siteUsage, sortSites, type SiteSortKey } from "../../../lib/site-card";

const DAY_MS = 24 * 3_600_000;
const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

export default function SitiosPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus sitios." />;
  }

  return <SitesDashboard organizationId={activeOrganizationId} />;
}

function SitesDashboard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const router = useRouter();
  const sitesQuery = useSites(organizationId);
  const planQuery = useOrganizationPlan(organizationId);
  const catalogQuery = usePlanCatalog();
  const [sortKey, setSortKey] = useState<SiteSortKey>("recent");

  // Los límites del rango se fijan una vez por visita (misma razón que en el Inicio: si cambiaran en cada render, la clave de
  // consulta no se repetiría nunca y no habría caché).
  const [range] = useState(() => {
    const now = new Date();
    return { from: isoDay(new Date(now.getTime() - 29 * DAY_MS)), to: isoDay(now) };
  });

  const sites = useMemo(() => (sitesQuery.data ?? []).filter((site) => site.status !== "ARCHIVED"), [sitesQuery.data]);

  // Una consulta de visitas por sitio (el filtro `siteId` ya existe en la API). Misma clave que `useAnalyticsOverview`, así que el
  // caché se comparte con el Inicio y con Analítica.
  const overviews = useQueries({
    queries: sites.map((site) => ({
      queryKey: ["analytics-overview", organizationId, { from: range.from, to: range.to, siteId: site.id }],
      queryFn: () => getAnalyticsOverview(organizationId, { from: range.from, to: range.to, siteId: site.id }),
      staleTime: 60_000,
    })),
  });

  const visitsBySite = useMemo(() => {
    const map = new Map<string, SiteVisits>();
    sites.forEach((site, index) => {
      const result = overviews[index];
      map.set(site.id, !result || result.isPending ? { state: "loading" } : result.isError || !result.data ? { state: "error" } : { state: "ready", overview: result.data });
    });
    return map;
  }, [sites, overviews]);

  const sorted = useMemo(() => {
    const visitCounts = new Map<string, number | undefined>();
    for (const [siteId, visits] of visitsBySite) visitCounts.set(siteId, visits.state === "ready" ? visits.overview.totals.pageViews : undefined);
    return sortSites(sites, sortKey, visitCounts);
  }, [sites, sortKey, visitsBySite]);

  if (sitesQuery.isPending) {
    return <SitesSkeleton />;
  }
  if (sitesQuery.isError) {
    return <ErrorState onRetry={() => void sitesQuery.refetch()} />;
  }

  const plan = planQuery.data?.plan;
  const usage = planQuery.data ? siteUsage(planQuery.data.usage.sites, planQuery.data.plan.limits.sites) : null;
  const nextPlan = plan ? nextPlanWithMoreSites(catalogQuery.data, plan) : null;
  const blockedReason = usage?.reached
    ? `Llegaste al límite de ${usage.limit} ${usage.limit === 1 ? "sitio" : "sitios"} de tu plan${plan ? ` ${plan.name}` : ""}. ${nextPlan ? `Sube a ${nextPlan.name} para crear más.` : "Cambia de plan para crear más."}`
    : null;
  const takenSlugs = sitesQuery.data.map((site) => site.slug);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-lg font-semibold text-foreground">Sitios</h1>
          <p className="text-sm text-muted-foreground">Tus portales: su enlace, su dominio, su código QR y cómo van las visitas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* PL4: el asistente crea el sitio desde una plantilla; «Crear sitio» sigue creando uno vacío. */}
          <GuardedAction reason={blockedReason}>
            {blockedReason ? (
              <Button type="button" variant="secondary" disabled>
                <LayoutTemplate className="size-4" aria-hidden="true" /> Crear con una plantilla
              </Button>
            ) : (
              <Button asChild variant="secondary">
                <Link href="/bienvenida">
                  <LayoutTemplate className="size-4" aria-hidden="true" /> Crear con una plantilla
                </Link>
              </Button>
            )}
          </GuardedAction>
          <GuardedAction reason={blockedReason}>
            {blockedReason ? (
              <Button type="button" disabled>
                <PlusCircle className="size-4" aria-hidden="true" /> Crear sitio
              </Button>
            ) : (
              <Button asChild>
                <Link href="/sitios/nuevo">
                  <PlusCircle className="size-4" aria-hidden="true" /> Crear sitio
                </Link>
              </Button>
            )}
          </GuardedAction>
        </div>
      </div>

      {planQuery.isSuccess && plan ? (
        <SitesPlanUsage used={planQuery.data.usage.sites} limit={plan.limits.sites} planName={plan.name} nextPlan={nextPlan} />
      ) : null}

      {sites.length === 0 ? (
        <SitesEmpty blocked={blockedReason !== null} />
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {sites.length} {sites.length === 1 ? "sitio" : "sitios"}
            </p>
            <div className="w-full sm:w-56">
              <Select
                label="Ordenar por"
                value={sortKey}
                options={SITE_SORT_OPTIONS}
                onChange={(event) => {
                  if (isSiteSortKey(event.target.value)) setSortKey(event.target.value);
                }}
              />
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Tus sitios">
            {sorted.map((site) => (
              <SiteCard
                key={site.id}
                organizationId={organizationId}
                site={site}
                visits={visitsBySite.get(site.id) ?? { state: "loading" }}
                takenSlugs={takenSlugs}
                // Al duplicar, se va directo a la copia: es lo que la persona quiere revisar y publicar.
                onDuplicated={(copy) => router.push(`/sitios/${copy.id}`)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Tarjetas de carga con la misma forma que las reales: sin saltos de diseño al llegar los datos. */
function SitesSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5" role="status" aria-busy="true" aria-label="Cargando tus sitios">
      <div className="h-8 w-40 animate-pulse rounded-md bg-surface" />
      <div className="h-20 w-full animate-pulse rounded-lg bg-surface" />
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
            <div className="h-40 animate-pulse bg-surface" />
            <div className="flex flex-col gap-3 p-4">
              <div className="h-5 w-2/3 animate-pulse rounded-md bg-surface" />
              <div className="h-4 w-1/2 animate-pulse rounded-md bg-surface" />
              <div className="h-12 w-full animate-pulse rounded-md bg-surface" />
            </div>
          </li>
        ))}
      </ul>
      <span className="sr-only">Cargando tus sitios…</span>
    </div>
  );
}

function SitesEmpty({ blocked }: { blocked: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-5 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-14 text-center">
      {/* Ilustración: un portal en miniatura (portada, avatar y pila de botones). */}
      <svg viewBox="0 0 160 120" className="h-28 w-36" role="img" aria-label="Ilustración de un portal vacío">
        <rect x="30" y="8" width="100" height="104" rx="10" fill="var(--color-background)" stroke="var(--color-border-strong)" strokeWidth="2" />
        <rect x="30" y="8" width="100" height="34" rx="10" fill="var(--color-primary)" opacity="0.9" />
        <circle cx="80" cy="46" r="13" fill="var(--color-background)" stroke="var(--color-primary)" strokeWidth="3" />
        <rect x="48" y="68" width="64" height="9" rx="4.5" fill="var(--color-primary)" opacity="0.85" />
        <rect x="48" y="83" width="64" height="9" rx="4.5" fill="var(--color-border)" />
        <rect x="48" y="98" width="64" height="9" rx="4.5" fill="var(--color-border)" />
        <path d="M134 18l2.4 5.2 5.6.8-4.1 3.9 1 5.6-4.9-2.7-5 2.7 1-5.6-4.1-3.9 5.7-.8z" fill="var(--color-warning)" />
      </svg>
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 className="text-base font-semibold text-foreground">Todavía no tienes ningún sitio</h2>
        <p className="text-sm text-muted-foreground">
          Crea tu primer portal: elige una plantilla lista para usar o empieza de cero. En minutos tendrás tu página con su enlace, su QR y sus visitas.
        </p>
      </div>
      {blocked ? (
        <p className="text-sm text-muted-foreground">Tu plan no permite crear sitios por ahora.</p>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/bienvenida">
              <Sparkles className="size-4" aria-hidden="true" /> Crear con una plantilla
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/sitios/nuevo">Empezar de cero</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
