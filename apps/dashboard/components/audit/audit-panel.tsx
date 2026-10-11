"use client";

import type { AuditEntryResponse } from "@impulza/contracts";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState, Select } from "@impulza/ui";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import type { AuditFilters } from "../../lib/api/audit";
import { useAgencyClients } from "../../lib/hooks/use-agency";
import { useAudit, useExportAudit } from "../../lib/hooks/use-audit";
import { actionLabel } from "./action-labels";

const PAGE_SIZE = 20;
const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "medium" });

/** Los grupos de acciones que se ofrecen como filtro (prefijos de los códigos de acción). */
const ACTION_GROUPS = [
  { value: "", label: "Todas las acciones" },
  { value: "page", label: "Páginas (crear, editar, publicar)" },
  { value: "publish", label: "Aprobación de publicaciones" },
  { value: "block", label: "Bloques" },
  { value: "site", label: "Sitios" },
  { value: "contact", label: "Contactos" },
  { value: "form", label: "Formularios" },
  { value: "booking", label: "Reservas" },
  { value: "order", label: "Pedidos" },
  { value: "campaign", label: "Campañas" },
  { value: "billing", label: "Facturación" },
  { value: "domain", label: "Dominios" },
  { value: "membership", label: "Equipo (invitar, cambiar rol, quitar)" },
  { value: "custom_role", label: "Roles personalizados" },
  { value: "agency", label: "Agencia" },
  { value: "audit", label: "Exportaciones de auditoría" },
];

/** Guarda un texto como archivo CSV (el BOM se conserva para que Excel respete las tildes). */
function saveCsv(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

/**
 * Auditoría de la organización o, en una agencia, de lo que su equipo hizo en sus clientes (F9.6d). Los filtros se aplican al enviar
 * el formulario (no en cada tecla) y todo lo calcula el servidor: paginación, recuento y exportación.
 */
export function AuditPanel({ organizationId, view }: { organizationId: string; view: "organization" | "agency" }): React.JSX.Element {
  const [draft, setDraft] = useState<AuditFilters>({});
  const [applied, setApplied] = useState<AuditFilters>({});
  const [offset, setOffset] = useState(0);
  const query = useAudit(organizationId, view, applied, PAGE_SIZE, offset);
  const exporter = useExportAudit(organizationId, view);
  const clients = useAgencyClients(organizationId, view === "agency");

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setApplied({ ...draft });
  };
  const clear = () => {
    setDraft({});
    setApplied({});
    setOffset(0);
  };
  const set = (key: keyof AuditFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const hasFilters = Object.values(applied).some((value) => value !== undefined && value !== "");

  return (
    <Card data-testid="audit-panel">
      <CardHeader className="gap-1">
        <CardTitle>{view === "agency" ? "Lo que tu equipo hizo en tus clientes" : "Registro de actividad"}</CardTitle>
        <CardDescription>
          {view === "agency"
            ? "Solo las acciones de personas de tu agencia con acceso delegado. Lo que cada cliente hace por su cuenta es de él."
            : "Quién hizo qué y cuándo en esta organización. Las acciones de una agencia se marcan como «vía agencia»."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={apply} className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Filtros de la auditoría">
          <Input label="Persona (correo)" value={draft.actor ?? ""} onChange={(event) => set("actor", event.target.value)} maxLength={100} placeholder="ana@" />
          <Select label="Acción" value={draft.action ?? ""} onChange={(event) => set("action", event.target.value)} options={ACTION_GROUPS} />
          <Input label="Desde" type="date" value={draft.from ?? ""} onChange={(event) => set("from", event.target.value)} />
          <Input label="Hasta" type="date" value={draft.to ?? ""} onChange={(event) => set("to", event.target.value)} />
          {view === "agency" ? (
            <Select
              label="Cliente"
              value={draft.client ?? ""}
              onChange={(event) => set("client", event.target.value)}
              options={[
                { value: "", label: "Todos los clientes" },
                ...(clients.data ?? []).map((client) => ({ value: client.clientOrganizationId, label: client.clientName })),
              ]}
            />
          ) : null}
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
            <Button type="submit">Aplicar filtros</Button>
            <Button type="button" variant="ghost" onClick={clear} disabled={!hasFilters && Object.values(draft).every((value) => !value)}>
              Limpiar
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="sm:ml-auto"
              loading={exporter.isPending}
              onClick={() => exporter.mutate(applied, { onSuccess: (csv) => saveCsv(view === "agency" ? "auditoria-agencia.csv" : "auditoria.csv", csv) })}
            >
              Exportar CSV
            </Button>
          </div>
        </form>
        {exporter.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(exporter.error, "No pudimos exportar. Intenta de nuevo.")}
          </p>
        ) : null}

        {query.isPending ? (
          <LoadingState label="Cargando la actividad…" />
        ) : query.isError && query.error instanceof ApiError && query.error.status === 403 ? (
          <EmptyState title="No tienes permiso para ver la auditoría" description="Solo el propietario y los administradores de la organización pueden verla." />
        ) : query.isError ? (
          <div className="flex flex-col gap-2">
            {query.error instanceof ApiError && query.error.status === 400 ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(query.error, "Revisa los filtros.")}
              </p>
            ) : (
              <ErrorState onRetry={() => void query.refetch()} />
            )}
          </div>
        ) : query.data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? "Nada coincide con estos filtros" : "Todavía no hay actividad"}
            description={hasFilters ? "Prueba con otro rango de fechas o quita algún filtro." : "Las acciones del equipo aparecerán aquí a medida que ocurran."}
          />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border" data-testid="audit-list">
              {query.data.items.map((entry) => (
                <AuditRow key={entry.id} entry={entry} showOrganization={view === "agency"} />
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, query.data.total)} de {query.data.total}
              </span>
              <span className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Anterior
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={offset + PAGE_SIZE >= query.data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Siguiente
                </Button>
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AuditRow({ entry, showOrganization }: { entry: AuditEntryResponse; showOrganization: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const hasDetail = entry.metadata !== null || entry.targetId !== null;
  return (
    <li className="flex flex-col gap-1 py-3" data-testid="audit-row" data-action={entry.action}>
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
        <span className="text-sm font-medium text-foreground">{actionLabel(entry.action)}</span>
        <time className="text-xs text-muted-foreground" dateTime={entry.createdAt}>
          {dateFormat.format(new Date(entry.createdAt))}
        </time>
      </div>
      <p className="text-xs text-muted-foreground">
        {entry.actor?.email ?? "Proceso del sistema"}
        {showOrganization && entry.organization ? ` · en ${entry.organization.name}` : ""}
        {entry.delegatedBy ? ` · vía agencia${entry.delegatedBy.agencyName ? ` ${entry.delegatedBy.agencyName}` : ""}` : ""}
        {" · "}
        <span className="font-mono">{entry.action}</span>
      </p>
      {hasDetail ? (
        <div>
          <button
            type="button"
            className="text-xs text-primary underline underline-offset-2"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Ocultar detalle" : "Ver detalle"}
          </button>
          {open ? (
            <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-surface p-3 text-xs text-foreground">
              {JSON.stringify({ recurso: entry.targetType, id: entry.targetId, ...(entry.metadata ?? {}) }, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
