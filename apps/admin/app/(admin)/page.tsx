"use client";

import { EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { useQuery } from "@tanstack/react-query";
import { Building2, Globe, ShieldOff, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { SignupsChart } from "../../components/signups-chart";
import { PageHeader, Section, StatusBadge } from "../../components/ui-bits";
import { adminApi } from "../../lib/api";
import { formatDate, formatInteger } from "../../lib/format";

function StatTile({ label, value, note, icon: Icon }: { label: string; value: number; note?: string; icon: LucideIcon }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{formatInteger(value)}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export default function OverviewPage(): React.JSX.Element {
  const overviewQuery = useQuery({ queryKey: ["admin", "overview"], queryFn: adminApi.overview });

  if (overviewQuery.isPending) {
    return <LoadingState label="Cargando el resumen de la plataforma…" />;
  }
  if (overviewQuery.isError) {
    return <ErrorState onRetry={() => overviewQuery.refetch()} />;
  }

  const { totals, signups, planDistribution, recentOrganizations } = overviewQuery.data;
  const maxPlan = Math.max(1, ...planDistribution.map((plan) => plan.organizations));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Resumen" description="Estado global de la plataforma. Solo metadatos: nunca contactos ni contenido de un cliente." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Usuarios" value={totals.users} icon={Users} />
        <StatTile label="Organizaciones" value={totals.organizations} icon={Building2} />
        <StatTile label="Sitios publicados" value={totals.publishedSites} note="Con al menos una página publicada." icon={Globe} />
        <StatTile label="Organizaciones bloqueadas" value={totals.blockedOrganizations} icon={ShieldOff} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title="Altas recientes" description="Por día, últimos 30 días (hora UTC)." className="xl:col-span-2">
          <SignupsChart signups={signups} />
        </Section>

        <Section title="Distribución por plan" description="Plan efectivo de cada organización.">
          {totals.organizations === 0 ? (
            <EmptyState title="Todavía no hay organizaciones" />
          ) : (
            <ul className="flex flex-col gap-3">
              {planDistribution.map((plan) => {
                const share = Math.round((plan.organizations / totals.organizations) * 100);
                return (
                  <li key={plan.planCode} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium text-foreground">{plan.planName}</span>
                      <span className="tabular-nums text-foreground">
                        {formatInteger(plan.organizations)} <span className="text-muted-foreground">· {share} %</span>
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-sm bg-primary/10" aria-hidden="true">
                      <div
                        className="h-2 rounded-sm bg-primary"
                        style={{ width: `${plan.organizations === 0 ? 0 : Math.max((plan.organizations / maxPlan) * 100, 2)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="Organizaciones nuevas"
        actions={
          <Link href="/organizaciones" className="text-sm font-medium text-primary hover:underline">
            Ver todas
          </Link>
        }
      >
        {recentOrganizations.length === 0 ? (
          <EmptyState title="Todavía no hay organizaciones" />
        ) : (
          <ul className="divide-y divide-border">
            {recentOrganizations.map((org) => (
              <li key={org.id}>
                <Link
                  href={`/organizaciones/${org.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm px-1 py-3 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{org.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{org.slug}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    <StatusBadge status={org.status} />
                    {formatDate(org.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
