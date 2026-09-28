"use client";

import type { AnalyticsOverviewResponse, AnalyticsSubjectRow } from "@impulza/contracts";
import type { BlockType } from "@impulza/validation";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@impulza/ui";
import { Contact, Eye, MousePointerClick, Percent, QrCode, Sparkles, Target, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatCompact, formatInteger, formatPercent, isoDayOffset } from "../../../components/analytics/format";
import { RankedBars } from "../../../components/analytics/ranked-bars";
import { SeriesChart } from "../../../components/analytics/series-chart";
import { StatTile } from "../../../components/analytics/stat-tile";
import { SiteInsightsCard } from "../../../components/ai/site-insights-card";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { BLOCK_LABELS } from "../../../lib/block-fields/labels";
import { isAiTaskAvailable, useAiStatus } from "../../../lib/hooks/use-ai";
import { useAnalyticsOverview } from "../../../lib/hooks/use-analytics";
import { useSites } from "../../../lib/hooks/use-sites";
import { PlanLimitNotice } from "../../../components/plan-limit-notice";
import { getPlanLimitInfo } from "../../../lib/plan-limit";

const RANGE_PRESETS = [
  { key: "7", label: "7 días", days: 7 },
  { key: "30", label: "30 días", days: 30 },
  { key: "90", label: "90 días", days: 90 },
] as const;

const MAX_RANGE_DAYS = 366;

const FUNNEL_LABELS: Record<AnalyticsOverviewResponse["funnel"][number]["step"], string> = {
  visitors: "Visitantes",
  clicks: "Clics en bloques",
  formSubmits: "Envíos de formulario",
  leads: "Leads nuevos",
};

type RangeState = { preset: (typeof RANGE_PRESETS)[number]["key"] } | { preset: "custom"; from: string; to: string };

function resolveRange(range: RangeState): { from: string; to: string } {
  if (range.preset === "custom") {
    return { from: range.from, to: range.to };
  }
  const days = RANGE_PRESETS.find((preset) => preset.key === range.preset)?.days ?? 30;
  return { from: isoDayOffset(days - 1), to: isoDayOffset(0) };
}

function customRangeError(from: string, to: string): string | null {
  if (!from || !to) {
    return "Elige las dos fechas.";
  }
  if (to < from) {
    return "La fecha final no puede ser anterior a la inicial.";
  }
  const days = (Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000) + 1;
  return days > MAX_RANGE_DAYS ? `El rango no puede superar ${MAX_RANGE_DAYS} días.` : null;
}

export default function AnaliticaPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para ver su analítica."
      />
    );
  }

  return <AnalyticsDashboard organizationId={activeOrganizationId} />;
}

function AnalyticsDashboard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const sitesQuery = useSites(organizationId);
  const [siteId, setSiteId] = useState("");
  const [range, setRange] = useState<RangeState>({ preset: "30" });
  const [customDraft, setCustomDraft] = useState({ from: isoDayOffset(29), to: isoDayOffset(0) });

  const draftError = customRangeError(customDraft.from, customDraft.to);
  const { from, to } = resolveRange(range);
  const overviewQuery = useAnalyticsOverview(organizationId, { from, to, siteId: siteId || undefined });
  const aiStatus = useAiStatus(organizationId);
  const insightsDays = range.preset === "7" ? 7 : range.preset === "90" ? 90 : 30;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Analítica</h1>
        <p className="text-sm text-muted-foreground">
          Cómo llegan las personas a tus sitios y cuántas terminan en contacto. Sin datos personales:
          los visitantes son anónimos y el tráfico automático (bots) no cuenta.
        </p>
      </div>

      {/* Filtros en una sola fila, arriba de todo lo que filtran. */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 lg:flex-row lg:items-end">
        <div className="lg:w-64">
          <Select
            label="Sitio"
            options={[
              { value: "", label: "Todos los sitios" },
              ...(sitesQuery.data ?? []).map((site) => ({ value: site.id, label: site.name })),
            ]}
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
          />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-foreground">Período</legend>
          <div className="flex flex-wrap gap-2">
            {RANGE_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                variant={range.preset === preset.key ? "primary" : "secondary"}
                aria-pressed={range.preset === preset.key}
                onClick={() => setRange({ preset: preset.key })}
              >
                {preset.label}
              </Button>
            ))}
            <Button
              type="button"
              variant={range.preset === "custom" ? "primary" : "secondary"}
              aria-pressed={range.preset === "custom"}
              onClick={() => {
                if (!draftError) {
                  setRange({ preset: "custom", ...customDraft });
                }
              }}
            >
              Personalizado
            </Button>
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3 lg:w-80">
          <Input
            label="Desde"
            type="date"
            value={customDraft.from}
            max={customDraft.to}
            onChange={(event) => {
              const next = { ...customDraft, from: event.target.value };
              setCustomDraft(next);
              if (range.preset === "custom" && !customRangeError(next.from, next.to)) {
                setRange({ preset: "custom", ...next });
              }
            }}
          />
          <Input
            label="Hasta"
            type="date"
            value={customDraft.to}
            min={customDraft.from}
            max={isoDayOffset(0)}
            onChange={(event) => {
              const next = { ...customDraft, to: event.target.value };
              setCustomDraft(next);
              if (range.preset === "custom" && !customRangeError(next.from, next.to)) {
                setRange({ preset: "custom", ...next });
              }
            }}
          />
        </div>
      </div>
      {draftError && range.preset === "custom" ? (
        <p role="alert" className="-mt-3 text-sm text-danger">
          {draftError}
        </p>
      ) : null}

      {/* F6.4: la lectura con IA es por sitio (las recomendaciones apuntan a una página concreta). */}
      {isAiTaskAvailable(aiStatus.data, "insights") ? (
        siteId ? (
          <SiteInsightsCard key={siteId} organizationId={organizationId} siteId={siteId} initialDays={insightsDays} />
        ) : (
          <p className="flex items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-muted-foreground">
            <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
            Elige un sitio arriba para pedir una lectura con IA de sus números.
          </p>
        )
      ) : null}

      {overviewQuery.isPending ? (
        <LoadingState label="Cargando analítica…" />
      ) : overviewQuery.isError && getPlanLimitInfo(overviewQuery.error) ? (
        // Rango más largo que el historial del plan (F4.3): no es un error a reintentar.
        <PlanLimitNotice error={overviewQuery.error} />
      ) : overviewQuery.isError ? (
        <ErrorState onRetry={() => overviewQuery.refetch()} />
      ) : (
        <OverviewContent data={overviewQuery.data} refreshing={overviewQuery.isFetching} />
      )}
    </div>
  );
}

function hasAnyActivity(data: AnalyticsOverviewResponse): boolean {
  return Object.values(data.totals).some((value) => value > 0);
}

function OverviewContent({ data, refreshing }: { data: AnalyticsOverviewResponse; refreshing: boolean }): React.JSX.Element {
  const clicks = data.totals.blockClicks + data.totals.whatsappClicks;

  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", refreshing && "opacity-60")} aria-busy={refreshing}>
      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile icon={Eye} label="Visitas" value={formatCompact(data.totals.pageViews)} />
        <StatTile
          icon={Users}
          label="Visitantes"
          value={formatCompact(data.totals.visitors)}
          note="Únicos por día"
        />
        <StatTile
          icon={MousePointerClick}
          label="Clics"
          value={formatCompact(clicks)}
          note={data.totals.whatsappClicks > 0 ? `${formatInteger(data.totals.whatsappClicks)} a WhatsApp` : undefined}
        />
        <StatTile icon={Target} label="Leads" value={formatCompact(data.totals.leads)} note="Desde formularios" />
        <StatTile
          icon={Percent}
          label="Conversión"
          value={data.conversionRate === null ? "—" : formatPercent(data.conversionRate)}
          note="Leads sobre visitantes"
        />
        <StatTile
          icon={Contact}
          label="Contactos nuevos"
          value={formatCompact(data.totals.newContacts)}
          note="Toda la organización"
        />
      </section>

      {!hasAnyActivity(data) ? (
        <EmptyState
          title="Todavía no hay actividad en este período"
          description="Las visitas, clics y envíos de tus sitios publicados aparecen acá a los pocos segundos. Prueba con un período más largo, o comparte tu sitio o un enlace corto para empezar a medir."
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href="/enlaces">Crear un enlace corto</Link>
            </Button>
          }
        />
      ) : (
        <>
          <section aria-labelledby="serie-titulo" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
            <h2 id="serie-titulo" className="text-base font-semibold text-foreground">
              Actividad por día
            </h2>
            <SeriesChart series={data.series} />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel title="Embudo de conversión" description="De cada etapa, cuánto llega a la siguiente.">
              <Funnel funnel={data.funnel} />
            </Panel>
            <Panel title="Dispositivo" description="Visitas por tipo de dispositivo.">
              <RankedBars
                items={data.devices.map((row) => ({ key: row.key, label: row.label, value: row.value }))}
                emptyLabel="Sin visitas en el período."
              />
            </Panel>
            <Panel title="País" description="Aproximado, informado por la red; nunca a partir de la IP guardada.">
              <RankedBars
                items={data.countries.map((row) => ({ key: row.key, label: row.label, value: row.value }))}
                emptyLabel="Sin datos de país todavía (depende del hosting del sitio)."
              />
            </Panel>
            <Panel title="Campañas" description="Visitas por fuente (utm_source) y por campaña (utm_campaign).">
              <div className="flex flex-col gap-5">
                <RankedBars
                  items={data.utmSources.map((row) => ({ key: row.key, label: row.label, value: row.value }))}
                  total={data.totals.pageViews}
                  emptyLabel="Ninguna visita llegó con utm_source."
                />
                {data.utmCampaigns.length > 0 ? (
                  <RankedBars
                    items={data.utmCampaigns.map((row) => ({ key: row.key, label: row.label, value: row.value }))}
                    total={data.totals.pageViews}
                    emptyLabel=""
                  />
                ) : null}
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Panel title="Páginas más vistas">
              <SubjectTable rows={data.topPages} valueLabel="Visitas" emptyLabel="Sin visitas en el período." />
            </Panel>
            <Panel title="Bloques con más clics">
              <SubjectTable
                rows={data.topBlocks}
                valueLabel="Clics"
                emptyLabel="Nadie hizo clic en un bloque todavía."
                labelFor={(row) => row.label ?? (row.kind ? (BLOCK_LABELS[row.kind as BlockType] ?? row.kind) : null)}
                detailFor={(row) => {
                  const kind = row.kind ? (BLOCK_LABELS[row.kind as BlockType] ?? row.kind) : null;
                  return [row.label ? kind : null, row.detail].filter(Boolean).join(" · ") || null;
                }}
              />
            </Panel>
            <Panel title="Formularios">
              <SubjectTable
                rows={data.forms}
                valueLabel="Envíos"
                secondaryLabel="Leads"
                emptyLabel="Ningún formulario recibió envíos en el período."
              />
            </Panel>
            <Panel title="Enlaces cortos y QR" description="De toda la organización, aunque filtres por sitio.">
              <div className="flex flex-col gap-4">
                <SubjectTable rows={data.shortLinks} valueLabel="Clics" emptyLabel="Sin clics a enlaces cortos." />
                {data.qrCodes.length > 0 ? (
                  <SubjectTable rows={data.qrCodes} valueLabel="Escaneos" emptyLabel="" icon={QrCode} />
                ) : null}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Embudo como barras horizontales sobre la misma base (la primera etapa = 100 %): cada fila dice
 *  su valor, su porcentaje del inicio y cuánto pasó desde la etapa anterior. */
function Funnel({ funnel }: { funnel: AnalyticsOverviewResponse["funnel"] }): React.JSX.Element {
  const first = funnel[0]?.value ?? 0;

  return (
    <ol className="flex flex-col gap-3">
      {funnel.map((step, index) => {
        const previous = index > 0 ? (funnel[index - 1]?.value ?? 0) : null;
        const width = first > 0 ? Math.max((step.value / first) * 100, step.value > 0 ? 2 : 0) : 0;
        return (
          <li key={step.step} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-foreground">{FUNNEL_LABELS[step.step]}</span>
              <span className="tabular-nums text-foreground">
                {formatInteger(step.value)}
                {previous !== null && previous > 0 ? (
                  <span className="ml-1 text-muted-foreground">({formatPercent(step.value / previous)} de la etapa anterior)</span>
                ) : null}
              </span>
            </div>
            <div className="h-2 w-full rounded-sm bg-surface" aria-hidden="true">
              <div className="h-2 rounded-r-sm bg-primary" style={{ width: `${Math.min(width, 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SubjectTable({
  rows,
  valueLabel,
  secondaryLabel,
  emptyLabel,
  labelFor = (row) => row.label,
  detailFor = (row) => row.detail,
  icon: Icon,
}: {
  rows: AnalyticsSubjectRow[];
  valueLabel: string;
  secondaryLabel?: string;
  emptyLabel: string;
  labelFor?: (row: AnalyticsSubjectRow) => string | null;
  detailFor?: (row: AnalyticsSubjectRow) => string | null;
  icon?: typeof QrCode;
}): React.JSX.Element {
  if (rows.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead className="text-right">{valueLabel}</TableHead>
          {secondaryLabel ? <TableHead className="text-right">{secondaryLabel}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const label = row.deleted ? "Elemento eliminado" : (labelFor(row) ?? "Sin nombre");
          const detail = row.deleted ? null : detailFor(row);
          return (
            <TableRow key={row.id}>
              <TableCell className="max-w-0 w-full">
                <div className="flex items-center gap-2">
                  {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                  <div className="min-w-0">
                    <p className={cn("truncate", row.deleted ? "text-muted-foreground italic" : "text-foreground")} title={label}>
                      {label}
                    </p>
                    {detail ? (
                      <p className="truncate text-xs text-muted-foreground" title={detail}>
                        {detail}
                      </p>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right align-top tabular-nums">{formatInteger(row.value)}</TableCell>
              {secondaryLabel ? (
                <TableCell className="text-right align-top tabular-nums">{formatInteger(row.secondaryValue ?? 0)}</TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
