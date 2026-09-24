"use client";

import { EmptyState, ErrorState, Input, LoadingState, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@impulza/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PageHeader, Pagination, StatusBadge } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";
import { formatDate, formatInteger } from "../../../lib/format";
import { useDebounced } from "../../../lib/use-debounced";

const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "ACTIVE", label: "Activas" },
  { value: "BLOCKED", label: "Bloqueadas" },
];

export default function OrganizationsPage(): React.JSX.Element {
  // `useSearchParams` exige un límite de Suspense en el App Router (si no, `next build` falla).
  return (
    <Suspense fallback={<LoadingState label="Cargando…" />}>
      <OrganizationsList />
    </Suspense>
  );
}

function OrganizationsList(): React.JSX.Element {
  // `?buscar=` permite llegar desde Usuarios con la búsqueda ya hecha.
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("buscar") ?? "");
  const [status, setStatus] = useState<"" | "ACTIVE" | "BLOCKED">("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search.trim());

  const params = { search: debouncedSearch || undefined, status: status || undefined, page, pageSize: PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: ["admin", "organizations", params],
    queryFn: () => adminApi.organizations(params),
    // Mantiene la tabla mientras llega la página siguiente: sin saltos a "Cargando…" al paginar.
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Organizaciones" description="Busca por nombre, slug o el correo de cualquiera de sus miembros." />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-96">
          <Input
            label="Buscar"
            type="search"
            placeholder="Nombre, slug o correo"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sm:w-48">
          <Select
            label="Estado"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
          />
        </div>
      </div>

      {listQuery.isPending ? (
        <LoadingState label="Buscando organizaciones…" />
      ) : listQuery.isError ? (
        <ErrorState onRetry={() => listQuery.refetch()} />
      ) : listQuery.data.items.length === 0 ? (
        <EmptyState
          title={debouncedSearch || status ? "Ninguna organización coincide" : "Todavía no hay organizaciones"}
          description={debouncedSearch || status ? "Prueba con otro término o quita el filtro de estado." : undefined}
        />
      ) : (
        <div className="flex flex-col gap-3" aria-busy={listQuery.isFetching}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organización</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Miembros</TableHead>
                <TableHead className="text-right">Sitios</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Alta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.data.items.map((org) => (
                <TableRow key={org.id}>
                  <TableCell>
                    <Link href={`/organizaciones/${org.id}`} className="flex flex-col font-medium text-foreground hover:text-primary hover:underline">
                      {org.name}
                      <span className="text-xs font-normal text-muted-foreground">{org.slug}</span>
                    </Link>
                  </TableCell>
                  <TableCell>{org.planName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInteger(org.members)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatInteger(org.sites)}</TableCell>
                  <TableCell>
                    <StatusBadge status={org.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(org.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={listQuery.data.total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
