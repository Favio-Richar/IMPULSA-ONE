"use client";

import type { PageCampaignResponse } from "@impulza/contracts";
import { Button } from "@impulza/ui";
import { TEMPLATE_OBJECTIVE_LABELS, type PageCampaignStatus } from "@impulza/validation";
import { CalendarClock, CircleCheck, CircleSlash, Clock, Home, Radio, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useCancelPageCampaign, useDeletePageCampaign } from "../../lib/hooks/use-page-campaigns";
import { formatCampaignDateTime, formatRemaining, pageCampaignErrorMessage } from "../../lib/page-campaign-messages";
import { ConfirmButton } from "../confirm-button";
import { CampaignReport } from "./campaign-report";

// Estado con ícono y texto (nunca solo color): verde suave para la activa, neutro para el resto.
const STATUS_META: Record<PageCampaignStatus, { label: string; icon: LucideIcon; className: string }> = {
  active: { label: "Activa", icon: Radio, className: "border-success/40 bg-success/10 text-foreground" },
  scheduled: { label: "Programada", icon: CalendarClock, className: "border-border bg-surface text-foreground" },
  ended: { label: "Terminada", icon: CircleCheck, className: "border-border bg-surface text-muted-foreground" },
  cancelled: { label: "Cancelada", icon: CircleSlash, className: "border-border bg-surface text-muted-foreground" },
};

/**
 * Una campaña (F7.7): estado calculado con la hora del navegador (`status` llega ya resuelto, pero
 * la lista se vuelve a pedir cuando cruza un borde), ventana, cuenta regresiva y acciones. El
 * reporte se abre bajo la tarjeta para no salir de la lista.
 */
export function CampaignCard({
  organizationId,
  siteId,
  siteSlug,
  campaign,
  status,
  now,
  onEdit,
}: {
  organizationId: string;
  siteId: string;
  siteSlug: string;
  campaign: PageCampaignResponse;
  status: PageCampaignStatus;
  now: number;
  onEdit: () => void;
}): React.JSX.Element {
  const [reportOpen, setReportOpen] = useState(false);
  const cancel = useCancelPageCampaign(organizationId, siteId);
  const remove = useDeletePageCampaign(organizationId, siteId);
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;
  const actionError = pageCampaignErrorMessage(cancel.error ?? remove.error);
  const titleId = `campana-${campaign.id}-titulo`;

  const countdown =
    status === "scheduled"
      ? `Empieza en ${formatRemaining(new Date(campaign.startsAt).getTime() - now)}`
      : status === "active"
        ? `Termina en ${formatRemaining(new Date(campaign.endsAt).getTime() - now)}`
        : null;

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="min-w-0 break-words text-base font-semibold text-foreground">
              {campaign.name}
            </h3>
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${meta.className}`}>
              <StatusIcon className="size-3.5" aria-hidden="true" />
              {meta.label}
            </span>
            {campaign.replaceHome ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-foreground">
                <Home className="size-3.5" aria-hidden="true" />
                Toma el inicio
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {campaign.pageSlug === null ? <span className="text-danger">Página en la papelera</span> : <span className="font-mono text-foreground">/{campaign.pageSlug}</span>}
            {" · "}
            {TEMPLATE_OBJECTIVE_LABELS[campaign.objective]}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatCampaignDateTime(campaign.startsAt)} → {formatCampaignDateTime(campaign.endsAt)}
          </p>
          {countdown ? (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Clock className="size-4" aria-hidden="true" />
              {countdown}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button type="button" variant="secondary" size="sm" aria-expanded={reportOpen} onClick={() => setReportOpen((open) => !open)}>
            {reportOpen ? "Ocultar reporte" : "Ver reporte"}
          </Button>
          {status === "scheduled" || status === "active" ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
                Editar
              </Button>
              <ConfirmButton
                variant="ghost"
                size="sm"
                confirmLabel={status === "active" ? "¿Terminarla ahora?" : "¿Cancelarla?"}
                loading={cancel.isPending}
                onConfirm={() => cancel.mutate(campaign.id)}
              >
                {status === "active" ? "Terminar ahora" : "Cancelar"}
              </ConfirmButton>
            </>
          ) : null}
          {status !== "active" ? (
            <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Borrarla?" loading={remove.isPending} onConfirm={() => remove.mutate(campaign.id)}>
              Borrar
            </ConfirmButton>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      {reportOpen ? <CampaignReport organizationId={organizationId} siteId={siteId} siteSlug={siteSlug} campaign={{ ...campaign, status }} /> : null}
    </article>
  );
}
