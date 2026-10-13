"use client";

import { EmptyState, cn } from "@impulza/ui";
import {
  CalendarCheck,
  ChartColumn,
  ClipboardCheck,
  Globe,
  ImageIcon,
  Megaphone,
  Package,
  Palette,
  ShoppingBag,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Organization } from "../../lib/api/organizations";
import { useAgenda } from "../../lib/hooks/use-agenda";
import { useAnalyticsOverview } from "../../lib/hooks/use-analytics";
import { useOrders } from "../../lib/hooks/use-catalog";
import { usePublishRequests } from "../../lib/hooks/use-publish";
import { useSites } from "../../lib/hooks/use-sites";

// Inicio del propietario de un negocio. Solo usa lo que el panel ya consulta en otras pantallas (sitios, analítica,
// aprobaciones, pedidos, agenda): ningún endpoint nuevo. Cada tarjeta es independiente: si una consulta falla (por
// ejemplo, el rol no tiene ese permiso) esa tarjeta simplemente no aparece, y el resto sigue.

const numberFormat = new Intl.NumberFormat("es-CL");
const DAY_MS = 24 * 3_600_000;

const SHORTCUTS: ReadonlyArray<{ href: string; label: string; description: string; icon: LucideIcon }> = [
  { href: "/sitios", label: "Sitios", description: "Páginas, bloques y publicación.", icon: Globe },
  { href: "/contactos", label: "Contactos", description: "Personas que te escribieron o compraron.", icon: Users },
  { href: "/analitica", label: "Analítica", description: "Visitas, clics y conversiones.", icon: ChartColumn },
  { href: "/campanas", label: "Campañas", description: "Correos a tus contactos.", icon: Megaphone },
  { href: "/reservas", label: "Reservas", description: "Agenda y servicios.", icon: CalendarCheck },
  { href: "/catalogo", label: "Catálogo", description: "Productos y precios.", icon: Package },
  { href: "/medios", label: "Medios", description: "Imágenes y archivos.", icon: ImageIcon },
  { href: "/configuracion/marca", label: "Marca", description: "Colores y logo del negocio.", icon: Palette },
];

const SITE_STATUS_LABEL = { DRAFT: "Borrador", PUBLISHED: "Publicado", ARCHIVED: "Archivado" } as const;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function BusinessHome({
  organization,
  organizationId,
  membersSection,
}: {
  organization: Organization | undefined;
  organizationId: string;
  /** La tabla de miembros: una sección más del inicio, no su totalidad. */
  membersSection: React.ReactNode;
}): React.JSX.Element {
  // Los límites se fijan una vez por visita: si cambiaran en cada render, la clave de consulta no se repetiría nunca.
  const [range] = useState(() => {
    const now = new Date();
    return {
      from: isoDay(new Date(now.getTime() - 29 * DAY_MS)),
      to: isoDay(now),
      agendaFrom: now.toISOString(),
      agendaTo: new Date(now.getTime() + 7 * DAY_MS).toISOString(),
    };
  });

  const sitesQuery = useSites(organizationId);
  const analyticsQuery = useAnalyticsOverview(organizationId, { from: range.from, to: range.to });
  const approvalsQuery = usePublishRequests(organizationId, { status: "PENDING", limit: 1 });
  const ordersQuery = useOrders(organizationId, { page: 1 });
  const agendaQuery = useAgenda(organizationId, { from: range.agendaFrom, to: range.agendaTo, status: "CONFIRMED" });

  const sites = (sitesQuery.data ?? []).filter((site) => site.status !== "ARCHIVED");
  const publishedSites = sites.filter((site) => site.status === "PUBLISHED").length;
  const totals = analyticsQuery.data?.totals;
  const pendingApprovals = approvalsQuery.data?.total ?? 0;
  const newOrders = ordersQuery.data?.counts.NEW ?? 0;
  const upcomingBookings = agendaQuery.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-8" data-testid="business-home">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{organization?.name ?? "Tu negocio"}</h1>
        <p className="text-sm text-muted-foreground">Un resumen de cómo va tu presencia digital y los accesos más usados.</p>
      </header>

      <section aria-labelledby="home-status" className="flex flex-col gap-3">
        <h2 id="home-status" className="text-sm font-semibold text-foreground">
          Estado
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy={sitesQuery.isPending || analyticsQuery.isPending}>
          <StatCard
            href="/sitios"
            icon={Globe}
            label="Sitios"
            value={sitesQuery.isSuccess ? numberFormat.format(sites.length) : null}
            hint={sitesQuery.isSuccess ? `${numberFormat.format(publishedSites)} publicado${publishedSites === 1 ? "" : "s"}` : undefined}
            loading={sitesQuery.isPending}
          />
          {analyticsQuery.isError ? null : (
            <>
              <StatCard
                href="/analitica"
                icon={ChartColumn}
                label="Visitas · 30 días"
                value={totals ? numberFormat.format(totals.pageViews) : null}
                hint={totals ? `${numberFormat.format(totals.visitors)} visitantes` : undefined}
                loading={analyticsQuery.isPending}
              />
              <StatCard
                href="/contactos"
                icon={UserPlus}
                label="Contactos nuevos · 30 días"
                value={totals ? numberFormat.format(totals.newContacts) : null}
                loading={analyticsQuery.isPending}
              />
            </>
          )}
          {pendingApprovals > 0 ? (
            <StatCard
              href="/aprobaciones"
              icon={ClipboardCheck}
              label="Aprobaciones pendientes"
              value={numberFormat.format(pendingApprovals)}
              hint="Esperan tu revisión"
              emphasis
            />
          ) : null}
          {newOrders > 0 ? (
            <StatCard href="/pedidos" icon={ShoppingBag} label="Pedidos nuevos" value={numberFormat.format(newOrders)} hint="Sin atender" emphasis />
          ) : null}
          {upcomingBookings > 0 ? (
            <StatCard
              href="/reservas"
              icon={CalendarCheck}
              label="Reservas · próximos 7 días"
              value={numberFormat.format(upcomingBookings)}
              hint="Confirmadas"
            />
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="home-sites" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="home-sites" className="text-sm font-semibold text-foreground">
            Tus sitios
          </h2>
          <Link href="/sitios" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            Ver todos
          </Link>
        </div>
        {sitesQuery.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Cargando sitios…
          </p>
        ) : sitesQuery.isError ? (
          <p className="text-sm text-muted-foreground">No pudimos cargar tus sitios ahora. Vuelve a intentarlo en un momento.</p>
        ) : sites.length === 0 ? (
          <EmptyState
            title="Aún no tienes un sitio"
            description="Crea el primero para empezar a recibir visitas, contactos y pedidos."
            action={
              <Link href="/sitios/nuevo" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                Crear un sitio
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-background">
            {sites.slice(0, 5).map((site) => (
              <li key={site.id}>
                <Link
                  href={`/sitios/${site.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{site.name}</span>
                    <span className="truncate text-xs text-muted-foreground">/{site.slug}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium",
                      site.status === "PUBLISHED" ? "border-primary text-primary" : "border-border text-muted-foreground",
                    )}
                  >
                    {SITE_STATUS_LABEL[site.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="home-shortcuts" className="flex flex-col gap-3">
        <h2 id="home-shortcuts" className="text-sm font-semibold text-foreground">
          Accesos rápidos
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SHORTCUTS.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <li key={shortcut.href}>
                <Link
                  href={shortcut.href}
                  className="flex h-full items-start gap-3 rounded-lg border border-border bg-background p-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground">{shortcut.label}</span>
                    <span className="text-xs text-muted-foreground">{shortcut.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="home-members" className="flex flex-col gap-3">
        <h2 id="home-members" className="text-sm font-semibold text-foreground">
          Equipo
        </h2>
        {membersSection}
      </section>
    </div>
  );
}

function StatCard({
  href,
  icon: Icon,
  label,
  value,
  hint,
  loading = false,
  emphasis = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string | null;
  hint?: string | undefined;
  loading?: boolean;
  emphasis?: boolean;
}): React.JSX.Element {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          "flex h-full flex-col gap-2 rounded-lg border bg-background p-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          emphasis ? "border-primary" : "border-border",
        )}
      >
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {label}
        </span>
        <span className="text-2xl font-semibold text-foreground">
          {loading ? <span className="text-muted-foreground">…</span> : (value ?? "—")}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </Link>
    </li>
  );
}
