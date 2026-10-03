"use client";

import type { AgencyClientStatusValue } from "@impulza/validation";
import { AGENCY_CLIENT_STATUSES } from "@impulza/validation";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useEffect, useState } from "react";
import type { AgencyOverviewParams } from "../../lib/api/agency";
import { useAgencyOverview } from "../../lib/hooks/use-agency";
import { STATUS_TEXT } from "./agency-text";
import { ClientRow } from "./client-row";

const PAGE_SIZE = 10;

const SORTS = {
  recent: { label: "Más recientes", sort: "createdAt", order: "desc" },
  oldest: { label: "Más antiguos", sort: "createdAt", order: "asc" },
  "name-asc": { label: "Nombre (A–Z)", sort: "name", order: "asc" },
  "name-desc": { label: "Nombre (Z–A)", sort: "name", order: "desc" },
  status: { label: "Estado", sort: "status", order: "asc" },
} as const satisfies Record<string, { label: string; sort: NonNullable<AgencyOverviewParams["sort"]>; order: "asc" | "desc" }>;
type SortKey = keyof typeof SORTS;

const FILTERABLE_STATUSES = AGENCY_CLIENT_STATUSES.filter((status) => status !== "ENDED");

/** Los clientes de la agencia: búsqueda, filtro por estado, orden y paginación en el servidor. */
export function ClientsTable({ organizationId, days }: { organizationId: string; days: number }): React.JSX.Element {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AgencyClientStatusValue | "">("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [page, setPage] = useState(1);

  // Se espera a que deje de escribir para no pedir al servidor en cada letra.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { sort, order } = SORTS[sortKey];
  const overview = useAgencyOverview(organizationId, { days: days as 7 | 30 | 90, search, status: status || undefined, sort, order, page, pageSize: PAGE_SIZE }, true);
  const total = overview.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Si la página actual quedó vacía (p. ej. se soltó al último de la página), volver a la última que existe. Se ajusta durante
  // el render, con condición, que es lo que React recomienda en lugar de un efecto.
  if (overview.data && !overview.isPlaceholderData && overview.data.items.length === 0 && page > 1 && page !== pages) {
    setPage(pages);
  }

  const filtering = search !== "" || status !== "";
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatus("");
    setPage(1);
  };

  return (
    <section aria-labelledby="clients-heading" className="flex flex-col gap-3">
      <h2 id="clients-heading" className="text-base font-semibold text-foreground">
        Tus clientes
      </h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
        <Input label="Buscar cliente" type="search" placeholder="Nombre o identificador" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Estado</span>
          <select
            aria-label="Estado"
            className="h-10 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as AgencyClientStatusValue | "");
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {FILTERABLE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_TEXT[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Ordenar por</span>
          <select
            aria-label="Ordenar por"
            className="h-10 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground"
            value={sortKey}
            onChange={(event) => {
              setSortKey(event.target.value as SortKey);
              setPage(1);
            }}
          >
            {(Object.keys(SORTS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORTS[key].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {overview.isPending ? (
        <LoadingState label="Cargando clientes…" />
      ) : overview.isError || !overview.data ? (
        <ErrorState onRetry={() => void overview.refetch()} />
      ) : total === 0 && !filtering ? (
        <EmptyState title="Todavía no tienes clientes" description="Da de alta tu primer cliente o pide acceso a un negocio que ya existe, con los formularios de abajo." />
      ) : total === 0 ? (
        <EmptyState
          title="Ningún cliente coincide"
          description="Prueba con otro texto o quita los filtros."
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Quitar filtros
            </Button>
          }
        />
      ) : (
        <>
          <ul className={`grid gap-3 transition-opacity ${overview.isPlaceholderData ? "opacity-60" : ""}`} data-testid="agency-clients" aria-busy={overview.isPlaceholderData}>
            {overview.data.items.map((item) => (
              <ClientRow key={item.id} organizationId={organizationId} item={item} />
            ))}
          </ul>
          <nav aria-label="Páginas de clientes" className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="agency-pagination-summary">
              {total} cliente{total === 1 ? "" : "s"} · página {page} de {pages}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                Anterior
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}>
                Siguiente
              </Button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}
