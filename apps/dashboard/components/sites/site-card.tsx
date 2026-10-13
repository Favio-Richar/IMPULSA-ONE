"use client";

import type { AnalyticsOverviewResponse, SiteResponse } from "@impulza/contracts";
import { Button, buttonVariants, cn } from "@impulza/ui";
import { Check, Copy, CopyPlus, ExternalLink, Globe, Link2, Pencil, QrCode } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { env } from "../../lib/env";
import { useSiteDomains } from "../../lib/hooks/use-domains";
import { useArchiveSite, useSiteTheme } from "../../lib/hooks/use-sites";
import { domainBadge, sitePublicUrl } from "../../lib/site-card";
import { ConfirmButton } from "../confirm-button";
import { Sparkline } from "../analytics/sparkline";
import { DuplicateSiteDialog } from "./duplicate-site-dialog";
import { MENU_ITEM_CLASS, SiteActionsMenu } from "./site-actions-menu";
import { SiteCover } from "./site-cover";
import { SiteQrDialog } from "./site-qr-dialog";

const numberFormat = new Intl.NumberFormat("es-CL");

const STATUS_LABEL: Record<SiteResponse["status"], string> = { DRAFT: "Borrador", PUBLISHED: "Publicado", ARCHIVED: "Archivado" };
const STATUS_CLASS: Record<SiteResponse["status"], string> = {
  DRAFT: "bg-background/90 text-foreground border-border",
  PUBLISHED: "bg-success text-success-foreground border-transparent",
  ARCHIVED: "bg-background/90 text-muted-foreground border-border",
};

export type SiteVisits =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; overview: AnalyticsOverviewResponse };

/** Una tarjeta de sitio: portada con su tema, dirección pública, dominio, QR, visitas de 30 días y acciones. */
export function SiteCard({
  organizationId,
  site,
  visits,
  takenSlugs,
  onDuplicated,
}: {
  organizationId: string;
  site: SiteResponse;
  visits: SiteVisits;
  takenSlugs: readonly string[];
  onDuplicated: (copy: SiteResponse) => void;
}): React.JSX.Element {
  const theme = useSiteTheme(organizationId, site.id);
  const domains = useSiteDomains(organizationId, site.id);
  const archive = useArchiveSite(organizationId, site.id);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const badge = domains.data ? domainBadge(domains.data) : null;
  const url = sitePublicUrl(env.NEXT_PUBLIC_WEB_BASE_URL, site.slug, badge?.kind === "verified" ? badge.domain : null);
  const published = site.status === "PUBLISHED";
  const titleId = `site-${site.id}-title`;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <li className="flex">
      <article aria-labelledby={titleId} className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xs transition-shadow hover:shadow-md">
        <div className="relative">
          {theme.isSuccess ? <SiteCover tokens={theme.data.tokens} name={site.name} /> : <div aria-hidden="true" className="h-40 animate-pulse bg-surface" />}
          <span className={cn("absolute left-3 top-3 rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_CLASS[site.status])}>{STATUS_LABEL[site.status]}</span>
          <div className="absolute right-2 top-2 rounded-md bg-background/80 backdrop-blur-sm">
            <SiteActionsMenu label={`Acciones de ${site.name}`}>
              {(close) => (
                <>
                  <Link href={`/sitios/${site.id}`} className={MENU_ITEM_CLASS} onClick={close}>
                    <Pencil className="size-4" aria-hidden="true" /> Editar
                  </Link>
                  <button
                    type="button"
                    className={MENU_ITEM_CLASS}
                    onClick={() => {
                      close();
                      setDuplicating(true);
                    }}
                  >
                    <CopyPlus className="size-4" aria-hidden="true" /> Duplicar
                  </button>
                  <div className="mt-0.5 border-t border-border px-1.5 pt-1.5">
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      confirmLabel={`¿Archivar "${site.name}"?`}
                      loading={archive.isPending}
                      onConfirm={() => archive.mutate()}
                    >
                      Archivar
                    </ConfirmButton>
                    {archive.isError ? <p role="alert" className="px-1 pt-1 text-xs text-danger">No se pudo archivar.</p> : null}
                  </div>
                </>
              )}
            </SiteActionsMenu>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <h3 id={titleId} className="truncate text-base font-semibold text-foreground">
              <Link href={`/sitios/${site.id}`} className="hover:underline focus-visible:underline">
                {site.name}
              </Link>
            </h3>
            <div className="flex items-center gap-1.5">
              <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={url}>
                {url.replace(/^https?:\/\//, "")}
              </span>
              <button
                type="button"
                onClick={() => void copy()}
                aria-label={copied ? "Enlace copiado" : `Copiar el enlace de ${site.name}`}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              >
                {copied ? <Check className="size-4 text-success" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              </button>
            </div>
            <span role="status" aria-live="polite" className="sr-only">
              {copied ? "Enlace copiado al portapapeles" : copyFailed ? "No se pudo copiar el enlace" : ""}
            </span>
            {copyFailed ? <p className="text-xs text-danger">No pudimos copiar. Copia la dirección a mano.</p> : null}
          </div>

          <DomainLine organizationId={organizationId} siteId={site.id} loading={domains.isPending} failed={domains.isError} badge={badge} />

          <VisitsBlock visits={visits} />

          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            {published ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                <ExternalLink className="size-4" aria-hidden="true" /> Ver sitio
              </a>
            ) : (
              <Button type="button" variant="secondary" size="sm" disabled title="Publica el sitio para verlo en línea.">
                <ExternalLink className="size-4" aria-hidden="true" /> Ver sitio
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => setQrOpen(true)}>
              <QrCode className="size-4" aria-hidden="true" /> Generar QR
            </Button>
          </div>
          {!published ? <p className="-mt-1 text-xs text-muted-foreground">Aún está en borrador: publícalo para que se vea en línea.</p> : null}
        </div>
      </article>

      {duplicating ? (
        <DuplicateSiteDialog organizationId={organizationId} site={site} takenSlugs={takenSlugs} open onOpenChange={(open) => !open && setDuplicating(false)} onDuplicated={onDuplicated} />
      ) : null}
      {qrOpen ? <SiteQrDialog organizationId={organizationId} siteName={site.name} url={url} open onOpenChange={(open) => !open && setQrOpen(false)} /> : null}
    </li>
  );
}

function DomainLine({
  siteId,
  loading,
  failed,
  badge,
}: {
  organizationId: string;
  siteId: string;
  loading: boolean;
  failed: boolean;
  badge: ReturnType<typeof domainBadge> | null;
}): React.JSX.Element {
  const configure = (
    <Link href={`/sitios/${siteId}#dominio-propio`} className="font-medium text-primary underline-offset-2 hover:underline">
      {badge?.kind === "none" ? "Configurar dominio" : "Ver dominio"}
    </Link>
  );
  if (loading) return <div aria-hidden="true" className="h-6 w-40 animate-pulse rounded-md bg-surface" />;
  if (failed || !badge) return <p className="text-xs text-muted-foreground">No pudimos leer el dominio de este sitio.</p>;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      {badge.kind === "verified" ? (
        <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">Dominio verificado</span>
      ) : badge.kind === "pending" ? (
        <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">Pendiente de verificación</span>
      ) : (
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">Sin dominio propio</span>
      )}
      {badge.domain ? <span className="truncate text-muted-foreground">{badge.domain}</span> : null}
      {configure}
    </p>
  );
}

function VisitsBlock({ visits }: { visits: SiteVisits }): React.JSX.Element {
  if (visits.state === "loading") {
    return (
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className="h-6 w-28 animate-pulse rounded-md bg-surface" />
        <div className="h-10 w-full animate-pulse rounded-md bg-surface" />
      </div>
    );
  }
  if (visits.state === "error") {
    return <p className="text-xs text-muted-foreground">No pudimos cargar las visitas de este sitio.</p>;
  }
  const { totals, series } = visits.overview;
  return (
    <div className="flex flex-col gap-2" data-testid="site-visits">
      <div className="flex items-baseline gap-4">
        <p className="text-2xl font-semibold tabular-nums text-foreground">
          {numberFormat.format(totals.pageViews)}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">visitas · 30 días</span>
        </p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium tabular-nums text-foreground">{numberFormat.format(totals.visitors)}</span> {totals.visitors === 1 ? "visitante" : "visitantes"}
        </p>
      </div>
      <Sparkline series={series} />
    </div>
  );
}
