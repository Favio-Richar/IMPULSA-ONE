"use client";

import { Card, CardContent, ErrorState, LoadingState } from "@impulza/ui";
import { CircleAlert, ShieldCheck } from "lucide-react";
import { AGENCY_DASHBOARD_DAYS } from "@impulza/validation";
import { useAgencyDashboard } from "../../lib/hooks/use-agency";

const numberFormat = new Intl.NumberFormat("es-CL");

function Kpi({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId: string }): React.JSX.Element {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-foreground" data-testid={testId}>
          {value}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Selector del período: lo comparten los totales y la tabla de clientes. */
export function PeriodSelect({ days, onChange }: { days: number; onChange: (days: number) => void }): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-foreground">Período</span>
      <select
        aria-label="Período"
        className="h-10 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground"
        value={days}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {AGENCY_DASHBOARD_DAYS.map((option) => (
          <option key={option} value={option}>
            Últimos {option} días
          </option>
        ))}
      </select>
    </label>
  );
}

/** Totales de la agencia: solo suman los clientes activos (un cliente en pausa, archivado o sin aceptar no cuenta). */
export function AgencySummary({ organizationId, days }: { organizationId: string; days: number }): React.JSX.Element | null {
  const dashboard = useAgencyDashboard(organizationId, days, true);

  if (dashboard.isPending) return <LoadingState label="Calculando el resumen…" />;
  if (dashboard.isError || !dashboard.data) return <ErrorState onRetry={() => void dashboard.refetch()} />;

  const { clients, totals, alerts, billing } = dashboard.data;
  // Sin clientes no hay nada que sumar: la tabla de abajo guía a dar de alta el primero.
  if (clients.total === 0) return null;

  const active = clients.byStatus.ACTIVE;
  const notCounted = clients.total - active;

  return (
    <section aria-labelledby="summary-heading" className="flex flex-col gap-3" data-testid="agency-summary">
      <h2 id="summary-heading" className="text-base font-semibold text-foreground">
        Resumen
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Clientes activos" value={`${active} de ${clients.total}`} hint={notCounted > 0 ? `${notCounted} no suma${notCounted === 1 ? "" : "n"}` : undefined} testId="kpi-active" />
        <Kpi label="Visitas" value={numberFormat.format(totals.pageViews)} testId="kpi-page-views" />
        <Kpi label="Clics" value={numberFormat.format(totals.clicks)} testId="kpi-clicks" />
        <Kpi label="Contactos nuevos" value={numberFormat.format(totals.newContacts)} testId="kpi-contacts" />
        <Kpi label="Reservas" value={numberFormat.format(totals.bookings)} testId="kpi-bookings" />
        <Kpi label="Pedidos" value={numberFormat.format(totals.orders)} testId="kpi-orders" />
      </div>
      <p className="text-sm text-muted-foreground" data-testid="agency-billing-summary">
        Facturación: pagas tú el plan de <strong className="text-foreground">{billing.agencyPays}</strong> cliente{billing.agencyPays === 1 ? "" : "s"} ·{" "}
        <strong className="text-foreground">{billing.clientPays}</strong> cliente{billing.clientPays === 1 ? " paga" : "s pagan"} su propio plan
        {billing.pendingChanges > 0 ? ` · ${billing.pendingChanges} propuesta${billing.pendingChanges === 1 ? "" : "s"} esperando al propietario` : ""}.
      </p>
      {alerts.clientsWithAlerts > 0 ? (
        <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-foreground" data-testid="agency-alerts-summary">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            {alerts.clientsWithAlerts} cliente{alerts.clientsWithAlerts === 1 ? "" : "s"} con alertas
            {alerts.domainsFailed > 0 ? ` · ${alerts.domainsFailed} dominio${alerts.domainsFailed === 1 ? "" : "s"} con error` : ""}
            {alerts.domainsPending > 0 ? ` · ${alerts.domainsPending} sin verificar` : ""}
            {alerts.clientsNearPlanLimit > 0 ? ` · ${alerts.clientsNearPlanLimit} cerca del límite del plan` : ""}. Están marcadas en cada cliente, abajo.
          </span>
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="agency-no-alerts">
          <ShieldCheck className="size-4 text-success" aria-hidden="true" /> Sin alertas en tus clientes activos.
        </p>
      )}
    </section>
  );
}
