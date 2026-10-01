"use client";

import type { CampaignResponse } from "@impulza/contracts";
import { CAMPAIGN_STATUS_LABELS, type CampaignStatusValue } from "@impulza/validation";
import { buttonVariants, cn, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { Mail, Plus } from "lucide-react";
import Link from "next/link";
import { useCampaigns } from "../../lib/hooks/use-campaigns";
import { NewsletterStats } from "./newsletter-stats";

export const CAMPAIGN_STATUS_STYLES: Record<CampaignStatusValue, string> = {
  DRAFT: "border-border bg-surface text-foreground",
  SENDING: "border-primary/30 bg-primary/10 text-foreground",
  SENT: "border-success/30 bg-success/10 text-foreground",
  CANCELLED: "border-warning/40 bg-warning/10 text-foreground",
};

/** Barra de avance del envío: enviados (y fallidos u omitidos) sobre el total congelado. */
export function SendProgress({ campaign }: { campaign: CampaignResponse }): React.JSX.Element | null {
  if (campaign.recipientCount === 0) return null;
  const done = campaign.stats.sent + campaign.stats.failed + campaign.stats.skipped;
  const percent = Math.round((done / campaign.recipientCount) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`Avance del envío: ${percent} %`}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {campaign.stats.sent.toLocaleString("es-CL")} de {campaign.recipientCount.toLocaleString("es-CL")} enviados
      </p>
    </div>
  );
}

export function CampaignsList({ organizationId }: { organizationId: string }): React.JSX.Element {
  const campaignsQuery = useCampaigns(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Campañas</h1>
          <p className="text-sm text-muted-foreground">
            Correos de novedades para tus clientes. Solo llegan a quienes aceptaron recibirlos, y cada correo trae su enlace para darse de baja.
          </p>
        </div>
        <Link href="/campanas/nueva" className={buttonVariants({ size: "sm" })}>
          <Plus className="size-4" aria-hidden="true" />
          Nueva campaña
        </Link>
      </div>

      <NewsletterStats organizationId={organizationId} />

      {campaignsQuery.isPending ? (
        <LoadingState label="Cargando campañas…" />
      ) : campaignsQuery.isError ? (
        <ErrorState onRetry={() => campaignsQuery.refetch()} />
      ) : campaignsQuery.data.length === 0 ? (
        <EmptyState
          title="Todavía no hay campañas"
          description="Escribe tu primera campaña: eliges a quién, la pruebas en tu correo y la envías."
          action={
            <Link href="/campanas/nueva" className={buttonVariants({ size: "sm" })}>
              Crear campaña
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Campañas">
          {campaignsQuery.data.map((campaign) => (
            <li key={campaign.id}>
              <Link
                href={`/campanas/${campaign.id}`}
                className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] sm:flex-row sm:items-center"
                data-campaign={campaign.name}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-muted-foreground">
                  <Mail className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-foreground">{campaign.name}</span>
                    <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", CAMPAIGN_STATUS_STYLES[campaign.status])}>
                      {CAMPAIGN_STATUS_LABELS[campaign.status]}
                    </span>
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">{campaign.subject}</span>
                </span>
                <span className="sm:w-56">
                  {campaign.status === "DRAFT" ? (
                    <span className="text-sm text-muted-foreground">Sin enviar</span>
                  ) : (
                    <SendProgress campaign={campaign} />
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
