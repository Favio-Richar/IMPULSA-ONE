"use client";

import type { AgencyOverviewItem } from "@impulza/contracts";
import type { AgencyClientAction } from "@impulza/validation";
import { Button } from "@impulza/ui";
import { CircleAlert, Info, EyeOff, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActiveOrgStore } from "../../lib/active-org-store";
import { useAgencyClientAction } from "../../lib/hooks/use-agency";
import { ConfirmButton } from "../confirm-button";
import { BILLING_TEXT, STATUS_TEXT, errorText } from "./agency-text";
import { ClientBilling } from "./client-billing";
import { ClientTransfer } from "./client-transfer";

export { BILLING_TEXT, STATUS_TEXT, errorText };

function statusLabel(item: AgencyOverviewItem): string {
  if (item.status === "INVITED") return item.agencyCreated ? "Esperando al propietario" : "Solicitud pendiente del propietario";
  return STATUS_TEXT[item.status];
}

const numberFormat = new Intl.NumberFormat("es-CL");
const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" });

const ALERT_ICON = {
  critical: <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />,
  warning: <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />,
  info: <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />,
} as const;

const SEVERITY_TEXT = { critical: "Crítica", warning: "Aviso", info: "Información" } as const;

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-foreground">{numberFormat.format(value)}</dd>
    </div>
  );
}

/** Un cliente de la agencia: estado, rendimiento del período, plan, dominios, alertas y las acciones sobre la relación. */
export function ClientRow({ organizationId, item }: { organizationId: string; item: AgencyOverviewItem }): React.JSX.Element {
  const router = useRouter();
  const setActiveOrganizationId = useActiveOrgStore((state) => state.setActiveOrganizationId);
  const act = useAgencyClientAction(organizationId);
  const run = (action: AgencyClientAction, hidePublicSite?: boolean) => act.mutate({ clientId: item.id, action, hidePublicSite });
  // Pausar y archivar piden una confirmación con una elección: ocultar o no el sitio público del cliente mientras dure.
  const [choosing, setChoosing] = useState<"pause" | "archive" | null>(null);
  const [hideSite, setHideSite] = useState(false);
  const startChoosing = (action: "pause" | "archive") => {
    setHideSite(item.publicHidden);
    setChoosing(action);
  };

  // «Entrar» solo donde el servidor da acceso: activo, en pausa (lectura) o recién creado por la agencia.
  const canEnter = item.status === "ACTIVE" || item.status === "PAUSED" || item.status === "TRANSFERRING" || (item.status === "INVITED" && item.agencyCreated);
  const performance = item.performance;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4" data-client-slug={item.clientSlug}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-sm font-semibold text-foreground">{item.clientName}</p>
          <p className="truncate text-xs text-muted-foreground">{item.clientSlug}</p>
          <p className="text-sm text-foreground">
            <span data-testid="client-status">{statusLabel(item)}</span>
            <span className="text-muted-foreground"> · {BILLING_TEXT[item.billingMode]}</span>
          </p>
          {item.publicHidden ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-foreground" data-testid="client-public-hidden">
              <EyeOff className="size-3.5 text-warning" aria-hidden="true" /> Sitio público oculto (se muestra de nuevo al reanudar o soltar)
            </p>
          ) : null}
          {item.ownerInviteEmail ? <p className="text-xs text-muted-foreground">Invitación enviada a {item.ownerInviteEmail}</p> : null}
          {act.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorText(act.error, "No pudimos hacer ese cambio.")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEnter ? (
            <Button
              size="sm"
              onClick={() => {
                setActiveOrganizationId(item.clientOrganizationId);
                router.push("/");
              }}
            >
              Entrar
            </Button>
          ) : null}
          {item.status === "ACTIVE" ? (
            <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => startChoosing("pause")}>
              Pausar
            </Button>
          ) : null}
          {item.status === "PAUSED" ? (
            <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => run("resume")}>
              Reanudar
            </Button>
          ) : null}
          {item.status === "ACTIVE" || item.status === "PAUSED" || (item.status === "INVITED" && item.agencyCreated) ? (
            <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => startChoosing("archive")}>
              Archivar
            </Button>
          ) : null}
          {item.status === "ARCHIVED" ? (
            <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => run("unarchive")}>
              Desarchivar
            </Button>
          ) : null}
          <ConfirmButton
            size="sm"
            variant="ghost"
            confirmLabel="¿Soltar a este cliente? Perderás el acceso."
            loading={act.isPending}
            onConfirm={() => run("release")}
          >
            Soltar
          </ConfirmButton>
        </div>
      </div>

      {performance ? (
        <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 sm:grid-cols-5" data-testid="client-performance">
          <Metric label="Visitas" value={performance.pageViews} />
          <Metric label="Clics" value={performance.clicks} />
          <Metric label="Contactos nuevos" value={performance.newContacts} />
          <Metric label="Reservas" value={performance.bookings} />
          <Metric label="Pedidos" value={performance.orders} />
        </dl>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">Solo se mide a los clientes activos.</p>
      )}

      {item.plan || item.domains ? (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {item.plan ? (
            <li data-testid="client-plan">
              Plan {item.plan.name}
              {item.plan.usage.map((row) => ` · ${row.label} ${numberFormat.format(row.used)} ${row.limit === null ? "(sin límite)" : `de ${numberFormat.format(row.limit)}`}`).join("")}
            </li>
          ) : null}
          {item.domains && item.domains.verified + item.domains.pending + item.domains.failed > 0 ? (
            <li>
              Dominios: {item.domains.verified} verificado{item.domains.verified === 1 ? "" : "s"}, {item.domains.pending} sin verificar, {item.domains.failed} con error
            </li>
          ) : null}
          <li>{item.lastPublishedAt ? `Última publicación: ${dateFormat.format(new Date(item.lastPublishedAt))}` : "Sin páginas publicadas todavía"}</li>
        </ul>
      ) : null}

      <ClientBilling organizationId={organizationId} item={item} />
      <ClientTransfer organizationId={organizationId} item={item} />

      {item.alerts.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Alertas de este cliente" data-testid="client-alerts">
          {item.alerts.map((alert) => (
            <li key={alert.code} className="flex gap-2 text-sm text-foreground">
              {ALERT_ICON[alert.severity]}
              <span>
                <span className="sr-only">{SEVERITY_TEXT[alert.severity]}: </span>
                {alert.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {choosing ? (
        <div className="flex w-full flex-col gap-3 rounded-md border border-border bg-surface p-3" role="group" aria-label={choosing === "pause" ? "Confirmar pausa" : "Confirmar archivo"}>
          <p className="text-sm text-foreground">
            {choosing === "pause"
              ? "En pausa, tu equipo puede ver este negocio pero no hacer cambios."
              : "Archivado, tu equipo pierde el acceso a este negocio. Sus datos y sitios no se borran."}
          </p>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-0.5 size-4" checked={hideSite} onChange={(event) => setHideSite(event.target.checked)} />
            <span>
              También ocultar su sitio público mientras dure
              <span className="block text-xs text-muted-foreground">
                Sus visitantes verán que el sitio no existe. No se borra nada: se muestra de nuevo al reanudar, desarchivar o soltar, y su propietario lo ve en su panel.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={act.isPending}
              onClick={() => {
                run(choosing, hideSite);
                setChoosing(null);
              }}
            >
              {choosing === "pause" ? "Confirmar pausa" : "Confirmar archivo"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChoosing(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
