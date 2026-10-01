"use client";

import type { PageCampaignResponse } from "@impulza/contracts";
import { Button, ErrorState, LoadingState, Select } from "@impulza/ui";
import { PAGE_CAMPAIGN_SOURCES, QR_STYLE_CATALOG, pageCampaignUrl, type PageCampaignSource } from "@impulza/validation";
import { CalendarCheck, Check, Copy, CreditCard, Eye, MessageSquare, MousePointerClick, Percent, QrCode, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { env } from "../../lib/env";
import { getPlanLimitInfo } from "../../lib/plan-limit";
import { usePageCampaignReport } from "../../lib/hooks/use-page-campaigns";
import { useCreateQrCode } from "../../lib/hooks/use-qr-codes";
import { formatCampaignDateTime } from "../../lib/page-campaign-messages";
import { formatInteger, formatPercent } from "../analytics/format";
import { RankedBars } from "../analytics/ranked-bars";
import { StatTile } from "../analytics/stat-tile";
import { PlanLimitNotice } from "../plan-limit-notice";
import { QrCodeImage } from "../qr-code-image";

const SOURCE_LABELS: Record<PageCampaignSource, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  email: "Correo",
  qr: "Código QR",
  otro: "Otro",
};

function sourceLabel(source: string | null): string {
  if (source === null) {
    return "Directo o sin UTM";
  }
  return (SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

/**
 * Resultados de una campaña (F7.7): visitas de la página en su ventana y qué hicieron después esas
 * mismas visitas, más el enlace con UTM listo para compartir y su QR. Las cifras salen del servidor
 * (eventos anónimos, ADR-004); acá solo se presentan.
 */
export function CampaignReport({
  organizationId,
  siteId,
  siteSlug,
  campaign,
}: {
  organizationId: string;
  siteId: string;
  siteSlug: string;
  campaign: PageCampaignResponse;
}): React.JSX.Element {
  const report = usePageCampaignReport(organizationId, siteId, campaign.id);

  return (
    <div className="flex flex-col gap-5 border-t border-border pt-4">
      {report.isPending ? (
        <LoadingState label="Cargando resultados…" />
      ) : report.isError ? (
        <ErrorState title="No pudimos cargar los resultados" onRetry={() => void report.refetch()} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Del {formatCampaignDateTime(report.data.from)} al {formatCampaignDateTime(report.data.to)}
            {campaign.status === "active" ? " (sigue activa)" : ""}.
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={Eye} label="Visitas" value={formatInteger(report.data.visitors)} note="Visitas del día que vieron la página." />
            <StatTile
              icon={Percent}
              label="Conversión"
              value={report.data.conversion === null ? "—" : formatPercent(report.data.conversion)}
              note="Terminaron en contacto, reserva o pedido."
            />
            <StatTile icon={MousePointerClick} label="Clics" value={formatInteger(report.data.interactions)} />
            <StatTile icon={MessageSquare} label="Contactos" value={formatInteger(report.data.leads)} />
            <StatTile icon={CalendarCheck} label="Reservas" value={formatInteger(report.data.bookings)} />
            <StatTile icon={ShoppingBag} label="Pedidos" value={formatInteger(report.data.orders)} />
            <StatTile icon={CreditCard} label="Pagos" value={formatInteger(report.data.payments)} note="Pedidos o abonos ya pagados." />
          </div>
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold text-foreground">De dónde llegaron</h4>
            <RankedBars
              items={report.data.sources.map((row) => ({ key: row.source ?? "__directo", label: sourceLabel(row.source), value: row.visitors }))}
              total={report.data.visitors}
              emptyLabel={report.data.visitors === 0 ? "Todavía no hay visitas en la ventana de la campaña." : "Sin fuentes registradas."}
            />
          </div>
        </>
      )}

      {campaign.pageSlug !== null && (campaign.status === "scheduled" || campaign.status === "active") ? (
        <CampaignLinkBuilder organizationId={organizationId} siteSlug={siteSlug} pageSlug={campaign.pageSlug} utmCampaign={campaign.utmCampaign} />
      ) : null}
    </div>
  );
}

function CampaignLinkBuilder({
  organizationId,
  siteSlug,
  pageSlug,
  utmCampaign,
}: {
  organizationId: string;
  siteSlug: string;
  pageSlug: string;
  utmCampaign: string;
}): React.JSX.Element {
  const [source, setSource] = useState<PageCampaignSource>("instagram");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const createQr = useCreateQrCode(organizationId);
  const url = pageCampaignUrl({ publicBaseUrl: env.NEXT_PUBLIC_WEB_BASE_URL, siteSlug, pageSlug, utmCampaign, source });
  const qrUrl = pageCampaignUrl({ publicBaseUrl: env.NEXT_PUBLIC_WEB_BASE_URL, siteSlug, pageSlug, utmCampaign, source: "qr" });
  const brand = QR_STYLE_CATALOG.find((preset) => preset.key === "marca") ?? QR_STYLE_CATALOG[0];

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-semibold text-foreground">Enlace para compartir</h4>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-48">
          <Select
            label="Dónde lo compartes"
            options={PAGE_CAMPAIGN_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }))}
            value={source}
            onChange={(event) => {
              setSource(event.target.value as PageCampaignSource);
              setCopied(false);
            }}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground" title={url}>
            {url}
          </code>
          <Button type="button" variant="secondary" size="sm" onClick={() => void copy()} aria-label="Copiar enlace">
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
      </div>
      {copyFailed ? (
        <p role="alert" className="text-sm text-danger">
          No pudimos copiar. Selecciona el enlace y cópialo a mano.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">Cada fuente lleva su propio utm_source, así el reporte separa de dónde llegó cada visita.</p>

      <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center">
        {createQr.isSuccess && brand ? (
          <QrCodeImage
            value={`${env.NEXT_PUBLIC_WEB_BASE_URL}/qr/${createQr.data.id}`}
            foreground={brand.foreground}
            background={brand.background}
            size={128}
          />
        ) : (
          <QrCode className="size-8 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {createQr.isSuccess
              ? "QR creado: lleva a la campaña con utm_source=qr y cuenta sus escaneos. Descárgalo desde Enlaces y QR."
              : "Un QR para afiches o el mostrador, que cuenta sus escaneos y llega a la campaña marcado como «Código QR»."}
          </p>
          {createQr.isSuccess ? null : (
            <div>
              <Button type="button" variant="secondary" size="sm" loading={createQr.isPending} onClick={() => createQr.mutate({ directUrl: qrUrl, styleKey: brand?.key ?? "marca" })}>
                Crear QR de la campaña
              </Button>
            </div>
          )}
          <PlanLimitNotice error={createQr.error} />
          {createQr.isError && !getPlanLimitInfo(createQr.error) ? (
            <p role="alert" className="text-sm text-danger">
              No pudimos crear el QR. Intenta de nuevo.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
