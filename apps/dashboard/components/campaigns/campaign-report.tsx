"use client";

import type { CampaignResponse } from "@impulza/contracts";
import { CAMPAIGN_STATUS_LABELS, campaignEmail, CONTACT_COMMERCIAL_STATUS_LABELS } from "@impulza/validation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@impulza/ui";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useCancelCampaign } from "../../lib/hooks/use-campaigns";
import { ConfirmButton } from "../confirm-button";
import { sourceLabel } from "./campaign-editor";
import { useSites } from "../../lib/hooks/use-sites";
import { CAMPAIGN_STATUS_STYLES, SendProgress } from "./campaigns-list";

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value.toLocaleString("es-CL")}</dd>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Una campaña ya enviada, enviándose o detenida (F5.6): métricas, avance y lo que se envió. */
export function CampaignReport({ organizationId, campaign }: { organizationId: string; campaign: CampaignResponse }): React.JSX.Element {
  const cancel = useCancelCampaign(organizationId, campaign.id);
  const sites = useSites(organizationId);
  const siteNames = new Map((sites.data ?? []).map((site) => [site.id, site.name]));
  const [error, setError] = useState<string | null>(null);
  const when = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : null;
  const preview = campaignEmail({ organizationName: "Tu negocio", subject: campaign.subject, bodyHtml: campaign.bodyHtml, unsubscribeUrl: "#baja" });
  const filters = [
    ...campaign.segment.tags.map((tag) => `Etiqueta: ${tag}`),
    ...campaign.segment.commercialStatuses.map((status) => `Estado: ${CONTACT_COMMERCIAL_STATUS_LABELS[status]}`),
    ...campaign.segment.sources.map((source) => `Origen: ${sourceLabel(source, siteNames)}`),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href="/campanas" className="text-sm text-muted-foreground hover:underline">
            ← Campañas
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{campaign.name}</h1>
            <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", CAMPAIGN_STATUS_STYLES[campaign.status])}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {campaign.status === "SENT" && campaign.sentAt ? `Terminó de enviarse el ${when(campaign.sentAt)}.` : null}
            {campaign.status === "SENDING"
              ? `Enviándose desde el ${when(campaign.sendStartedAt)}${campaign.emailsPerHour !== null ? `, hasta ${campaign.emailsPerHour.toLocaleString("es-CL")} correos por hora según tu plan` : ""}.`
              : null}
            {campaign.status === "CANCELLED" ? "Envío detenido: lo que no había salido ya no sale." : null}
          </p>
        </div>
        {campaign.status === "SENDING" ? (
          <ConfirmButton
            variant="secondary"
            size="sm"
            confirmLabel="¿Detener el envío?"
            loading={cancel.isPending}
            onConfirm={() =>
              cancel.mutate(undefined, {
                onError: (caught) =>
                  setError(caught instanceof ApiError && caught.status === 403 ? "Tu rol no permite detener campañas." : "No se pudo detener. Intenta de nuevo."),
              })
            }
          >
            Detener envío
          </ConfirmButton>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <SendProgress campaign={campaign} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Métricas de la campaña">
        <Stat label="Destinatarios" value={campaign.recipientCount} />
        <Stat label="Enviados" value={campaign.stats.sent} />
        <Stat label="Pendientes" value={campaign.stats.pending} />
        <Stat label="Fallidos" value={campaign.stats.failed} hint="No se pudieron entregar al proveedor." />
        <Stat label="Bajas" value={campaign.stats.unsubscribed} hint={campaign.stats.skipped > 0 ? `${campaign.stats.skipped} omitidos` : undefined} />
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>Lo que se envió</CardTitle>
          <CardDescription>
            Asunto: <span className="font-medium text-foreground">{campaign.subject}</span>
            {" · "}
            {filters.length > 0 ? filters.join(" · ") : "A todos los que aceptaron recibir correos"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <iframe title="Correo enviado" sandbox="" srcDoc={preview.html} className="h-96 w-full rounded-md border border-border bg-white" />
        </CardContent>
      </Card>
    </div>
  );
}
