"use client";

import type { PageCampaignResponse } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, LoadingState, buttonVariants } from "@impulza/ui";
import { pageCampaignStatus, type PageCampaignStatus } from "@impulza/validation";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CampaignCard } from "../../../../../components/page-campaigns/campaign-card";
import { CampaignEditorDialog } from "../../../../../components/page-campaigns/campaign-editor-dialog";
import { useActiveOrgStore } from "../../../../../lib/active-org-store";
import { ApiError } from "../../../../../lib/api-client";
import { usePageCampaigns } from "../../../../../lib/hooks/use-page-campaigns";
import { usePages } from "../../../../../lib/hooks/use-pages";
import { useSite } from "../../../../../lib/hooks/use-sites";

// Modo campaña (F7.7, ADR-022): páginas temporales que aparecen solas entre dos fechas, con su
// enlace medido y su reporte. El estado se recalcula con la hora del navegador cada 30 segundos, así
// una campaña pasa de "programada" a "activa" en pantalla sin recargar.

const TICK_MS = 30_000;

const GROUPS: { key: string; title: string; statuses: PageCampaignStatus[] }[] = [
  { key: "activas", title: "Activas", statuses: ["active"] },
  { key: "programadas", title: "Programadas", statuses: ["scheduled"] },
  { key: "cerradas", title: "Terminadas o canceladas", statuses: ["ended", "cancelled"] },
];

export default function ModoCampanaPage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus campañas." />;
  }
  return <Campaigns organizationId={activeOrganizationId} siteId={params.siteId} />;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function Campaigns({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const siteQuery = useSite(organizationId, siteId);
  const pagesQuery = usePages(organizationId, siteId);
  const campaignsQuery = usePageCampaigns(organizationId, siteId);
  const now = useNow();
  // `undefined` = cerrado; `null` = nueva; una campaña = editándola.
  const [editing, setEditing] = useState<PageCampaignResponse | null | undefined>(undefined);

  if (siteQuery.isPending || pagesQuery.isPending || campaignsQuery.isPending) {
    return <LoadingState label="Cargando campañas…" />;
  }
  if (siteQuery.isError || pagesQuery.isError || campaignsQuery.isError) {
    const error = siteQuery.error ?? pagesQuery.error ?? campaignsQuery.error;
    if (error instanceof ApiError && error.status === 404) {
      return <ErrorState title="Sitio no encontrado" description="No existe, o es de otra organización." />;
    }
    return (
      <ErrorState
        onRetry={() => {
          void siteQuery.refetch();
          void pagesQuery.refetch();
          void campaignsQuery.refetch();
        }}
      />
    );
  }

  const site = siteQuery.data;
  const eligiblePages = pagesQuery.data.filter((page) => !page.isHome && page.deletedAt === null && page.status === "PUBLISHED");
  const withStatus = campaignsQuery.data.map((campaign) => ({ campaign, status: pageCampaignStatus(campaign, new Date(now)) }));
  const canCreate = eligiblePages.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link href={`/sitios/${siteId}`} className="text-sm text-muted-foreground hover:underline">
            ← {site.name}
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Modo campaña</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Programa una página para una fecha especial — un Cyber Day, un lanzamiento, una promo de temporada. Aparece sola al empezar, puede
            tomar el lugar de tu inicio mientras dure y desaparece al terminar. Cada campaña tiene su enlace medido y su reporte.
          </p>
        </div>
        {canCreate ? (
          <Button type="button" className="shrink-0" onClick={() => setEditing(null)}>
            <Plus className="size-4" aria-hidden="true" />
            Nueva campaña
          </Button>
        ) : null}
      </div>

      {!canCreate && withStatus.length === 0 ? (
        <EmptyState
          title="Primero, una página para la campaña"
          description="Crea y publica una página aparte de tu inicio (por ejemplo «cyber-day»). Después vuelve acá para programar cuándo se ve."
          action={
            <Link href={`/sitios/${siteId}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Ir a las páginas del sitio
            </Link>
          }
        />
      ) : withStatus.length === 0 ? (
        <EmptyState
          title="Todavía no hay campañas"
          description="Elige una página publicada, sus fechas y si toma el inicio. Fuera de esas fechas nadie la ve."
          action={
            <Button type="button" size="sm" onClick={() => setEditing(null)}>
              Programar la primera
            </Button>
          }
        />
      ) : (
        GROUPS.map((group) => {
          const items = withStatus.filter((item) => group.statuses.includes(item.status));
          if (items.length === 0) {
            return null;
          }
          return (
            <section key={group.key} aria-labelledby={`campanas-${group.key}`} className="flex flex-col gap-3">
              <h2 id={`campanas-${group.key}`} className="text-base font-semibold text-foreground">
                {group.title} ({items.length})
              </h2>
              {items.map(({ campaign, status }) => (
                <CampaignCard
                  key={campaign.id}
                  organizationId={organizationId}
                  siteId={siteId}
                  siteSlug={site.slug}
                  campaign={campaign}
                  status={status}
                  now={now}
                  onEdit={() => setEditing(campaign)}
                />
              ))}
            </section>
          );
        })
      )}

      {!canCreate && withStatus.length > 0 ? (
        <p className="text-sm text-muted-foreground">Para programar otra campaña, publica una página aparte de tu inicio.</p>
      ) : null}

      {editing !== undefined ? (
        <CampaignEditorDialog
          key={editing?.id ?? "nueva"}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(undefined);
          }}
          organizationId={organizationId}
          siteId={siteId}
          campaign={editing}
          pages={eligiblePages}
        />
      ) : null}
    </div>
  );
}
