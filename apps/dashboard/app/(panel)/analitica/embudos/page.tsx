"use client";

import type { FunnelResponse } from "@impulza/contracts";
import { FUNNEL_MAX_PER_SITE, SUGGESTED_FUNNEL, type FunnelDevice } from "@impulza/validation";
import { Button, EmptyState, ErrorState, LoadingState, Select, cn } from "@impulza/ui";
import { AlertTriangle, CheckCircle2, Filter, LogIn, Pencil, Percent, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { AnalyticsTabs } from "../../../../components/analytics/analytics-tabs";
import { formatInteger, formatPercent, isoDayOffset } from "../../../../components/analytics/format";
import { StatTile } from "../../../../components/analytics/stat-tile";
import { ConfirmButton } from "../../../../components/confirm-button";
import { FunnelChart } from "../../../../components/funnels/funnel-chart";
import { FunnelEditorDialog } from "../../../../components/funnels/funnel-editor-dialog";
import { PlanLimitNotice } from "../../../../components/plan-limit-notice";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { ApiError } from "../../../../lib/api-client";
import { useDeleteFunnel, useFunnelReport, useFunnels, useSaveFunnel } from "../../../../lib/hooks/use-funnels";
import { useSites } from "../../../../lib/hooks/use-sites";
import { getPlanLimitInfo } from "../../../../lib/plan-limit";

const RANGE_PRESETS = [
  { key: "7", label: "7 días", days: 7 },
  { key: "30", label: "30 días", days: 30 },
  { key: "90", label: "90 días", days: 90 },
] as const;
type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

const DEVICE_OPTIONS: Array<{ value: "" | FunnelDevice; label: string }> = [
  { value: "", label: "Todos los dispositivos" },
  { value: "mobile", label: "Teléfono" },
  { value: "tablet", label: "Tablet" },
  { value: "desktop", label: "Computador" },
];

function writeErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "Tu rol puede ver los embudos, pero no crearlos, editarlos ni borrarlos.";
  }
  const message = error instanceof ApiError ? (error.body as { message?: unknown } | undefined)?.message : undefined;
  return typeof message === "string" ? message : "No pudimos completar la acción. Intenta de nuevo.";
}

export default function EmbudosPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus embudos." />;
  }

  return <FunnelsDashboard organizationId={activeOrganizationId} />;
}

function FunnelsDashboard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const sitesQuery = useSites(organizationId);
  const [chosenSiteId, setChosenSiteId] = useState("");
  const sites = (sitesQuery.data ?? []).filter((site) => site.status !== "ARCHIVED");
  // Un embudo es siempre de un sitio: por defecto, el primero.
  const siteId = chosenSiteId || sites[0]?.id || null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Analítica</h1>
        <p className="text-sm text-muted-foreground">
          Cuántas personas avanzan paso a paso hasta escribirte, reservar, comprar o pagar, y dónde se quedan. Anónimo: se cuenta cada
          visita del día, sin datos personales.
        </p>
      </div>
      <AnalyticsTabs />

      {sitesQuery.isPending ? (
        <LoadingState label="Cargando tus sitios…" />
      ) : sitesQuery.isError ? (
        <ErrorState title="No pudimos cargar tus sitios" onRetry={() => void sitesQuery.refetch()} />
      ) : siteId === null ? (
        <EmptyState title="Todavía no tienes sitios" description="Crea un sitio y publícalo: los embudos miden lo que hacen sus visitas." />
      ) : (
        <SiteFunnels
          key={siteId}
          organizationId={organizationId}
          siteId={siteId}
          siteSelect={
            <Select
              label="Sitio"
              value={siteId}
              options={sites.map((site) => ({ value: site.id, label: site.name }))}
              onChange={(event) => setChosenSiteId(event.target.value)}
            />
          }
        />
      )}
    </div>
  );
}

function SiteFunnels({ organizationId, siteId, siteSelect }: { organizationId: string; siteId: string; siteSelect: React.ReactNode }): React.JSX.Element {
  const funnelsQuery = useFunnels(organizationId, siteId);
  const saveMutation = useSaveFunnel(organizationId, siteId);
  const deleteMutation = useDeleteFunnel(organizationId, siteId);
  const [chosenFunnelId, setChosenFunnelId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; funnel: FunnelResponse | null; key: number }>({ open: false, funnel: null, key: 0 });
  const [rangeKey, setRangeKey] = useState<RangeKey>("30");
  const [device, setDevice] = useState<"" | FunnelDevice>("");

  const funnels = funnelsQuery.data ?? [];
  const selected = funnels.find((funnel) => funnel.id === chosenFunnelId) ?? funnels[0] ?? null;
  const days = RANGE_PRESETS.find((preset) => preset.key === rangeKey)!.days;
  const filters = { from: isoDayOffset(days - 1), to: isoDayOffset(0), ...(device ? { device } : {}) };
  const atLimit = funnels.length >= FUNNEL_MAX_PER_SITE;

  function openEditor(funnel: FunnelResponse | null): void {
    setEditor((current) => ({ open: true, funnel, key: current.key + 1 }));
  }

  function createSuggested(): void {
    saveMutation.mutate({ funnelId: null, input: SUGGESTED_FUNNEL }, { onSuccess: (created) => setChosenFunnelId(created.id) });
  }

  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 lg:flex-row lg:items-end">
        <div className="lg:w-64">{siteSelect}</div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-foreground">Período</legend>
          <div className="flex flex-wrap gap-2">
            {RANGE_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                variant={rangeKey === preset.key ? "primary" : "secondary"}
                aria-pressed={rangeKey === preset.key}
                onClick={() => setRangeKey(preset.key)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </fieldset>
        <div className="lg:w-56">
          <Select label="Dispositivo de entrada" value={device} options={DEVICE_OPTIONS} onChange={(event) => setDevice(event.target.value as "" | FunnelDevice)} />
        </div>
      </div>

      {funnelsQuery.isPending ? (
        <LoadingState label="Cargando embudos…" />
      ) : funnelsQuery.isError ? (
        <ErrorState title="No pudimos cargar los embudos" onRetry={() => void funnelsQuery.refetch()} />
      ) : funnels.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border-strong p-8 text-center">
          <Filter className="size-8 text-primary" aria-hidden="true" />
          <div className="flex max-w-lg flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">Todavía no tienes embudos en este sitio</h2>
            <p className="text-sm text-muted-foreground">
              Un embudo muestra cuántas visitas llegan a cada paso, en orden: por ejemplo, ver tu página, tocar un botón, escribirte y pagar.
              Empieza con el sugerido o arma el tuyo.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" loading={saveMutation.isPending} onClick={createSuggested}>
              <Sparkles className="size-4" aria-hidden="true" />
              Usar el embudo sugerido
            </Button>
            <Button type="button" variant="secondary" onClick={() => openEditor(null)}>
              <Plus className="size-4" aria-hidden="true" />
              Armar uno propio
            </Button>
          </div>
          {saveMutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              {writeErrorMessage(saveMutation.error)}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
          <section aria-label="Tus embudos" className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {funnels.map((funnel) => {
                const active = funnel.id === selected?.id;
                return (
                  <li key={funnel.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setChosenFunnelId(funnel.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                        active ? "border-primary bg-surface" : "border-border bg-background hover:bg-surface",
                      )}
                    >
                      <span className="text-sm font-medium text-foreground">{funnel.name}</span>
                      <span className="text-xs text-muted-foreground">{funnel.steps.length} pasos</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button type="button" variant="secondary" size="sm" disabled={atLimit} onClick={() => openEditor(null)}>
              <Plus className="size-4" aria-hidden="true" />
              Nuevo embudo
            </Button>
            {atLimit ? <p className="text-xs text-muted-foreground">Llegaste a {FUNNEL_MAX_PER_SITE} embudos en este sitio. Borra uno para crear otro.</p> : null}
          </section>

          {selected ? (
            <FunnelReport
              key={selected.id}
              organizationId={organizationId}
              siteId={siteId}
              funnel={selected}
              filters={filters}
              onEdit={() => openEditor(selected)}
              onDelete={() => deleteMutation.mutate(selected.id, { onSuccess: () => setChosenFunnelId(null) })}
              deleting={deleteMutation.isPending}
              deleteError={deleteMutation.isError ? writeErrorMessage(deleteMutation.error) : null}
            />
          ) : null}
        </div>
      )}

      {editor.open ? (
        <FunnelEditorDialog
          key={editor.key}
          organizationId={organizationId}
          siteId={siteId}
          funnel={editor.funnel}
          open={editor.open}
          onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
          onSaved={(saved) => {
            setChosenFunnelId(saved.id);
            setEditor((current) => ({ ...current, open: false }));
          }}
        />
      ) : null}
    </>
  );
}

function FunnelReport({
  organizationId,
  siteId,
  funnel,
  filters,
  onEdit,
  onDelete,
  deleting,
  deleteError,
}: {
  organizationId: string;
  siteId: string;
  funnel: FunnelResponse;
  filters: { from: string; to: string; device?: FunnelDevice };
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  deleteError: string | null;
}): React.JSX.Element {
  const reportQuery = useFunnelReport(organizationId, siteId, funnel.id, filters);
  const report = reportQuery.data;
  const entered = report?.steps[0]?.visitors ?? 0;
  const completed = report?.steps.at(-1)?.visitors ?? 0;
  const worst = report && report.biggestDropOffStep !== null ? report.steps[report.biggestDropOffStep] : null;

  return (
    <section aria-label={`Informe: ${funnel.name}`} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{funnel.name}</h2>
          <p className="text-sm text-muted-foreground">
            {funnel.steps.map((step) => (step.subjectLabel ? `${step.label} (${step.subjectLabel})` : step.label)).join(" → ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            Editar
          </Button>
          <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Borrar este embudo?" loading={deleting} onConfirm={onDelete}>
            Borrar
          </ConfirmButton>
        </div>
      </div>
      {deleteError ? (
        <p role="alert" className="text-sm text-danger">
          {deleteError}
        </p>
      ) : null}

      {reportQuery.isPending ? (
        <LoadingState label="Calculando el embudo…" />
      ) : reportQuery.isError ? (
        getPlanLimitInfo(reportQuery.error) ? (
          <PlanLimitNotice error={reportQuery.error} />
        ) : (
          <ErrorState title="No pudimos calcular el embudo" onRetry={() => void reportQuery.refetch()} />
        )
      ) : report ? (
        <div className={cn("flex flex-col gap-4 transition-opacity", reportQuery.isPlaceholderData && "opacity-60")} aria-busy={reportQuery.isFetching}>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile label="Entraron" value={formatInteger(entered)} icon={LogIn} note="Visitas que hicieron el primer paso." />
            <StatTile label="Completaron" value={formatInteger(completed)} icon={CheckCircle2} note="Llegaron al último paso, en orden." />
            <StatTile
              label="Conversión total"
              value={report.overallConversion === null ? "—" : formatPercent(report.overallConversion)}
              icon={Percent}
            />
            <StatTile
              label="Mayor abandono"
              value={worst ? worst.label : "—"}
              icon={AlertTriangle}
              note={worst && worst.dropOffRate !== null ? `${formatPercent(worst.dropOffRate)} no llega a este paso.` : "Nadie abandonó."}
            />
          </div>
          {entered === 0 ? (
            <EmptyState
              title="Sin visitas en este período"
              description="Nadie hizo el primer paso en estas fechas. Prueba con un período más largo o comparte tu página."
            />
          ) : (
            <FunnelChart report={report} />
          )}
        </div>
      ) : null}
    </section>
  );
}
