"use client";

import { EmptyState, ErrorState, Input, LoadingState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@impulza/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { PageHeader, Pagination, Tag } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";
import { formatDate, formatInteger } from "../../../lib/format";
import { useDebounced } from "../../../lib/use-debounced";

const PAGE_SIZE = 25;

export default function UsersPage(): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search.trim());
  const params = { search: debouncedSearch || undefined, page, pageSize: PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: ["admin", "users", params],
    queryFn: () => adminApi.users(params),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Usuarios" description="Cuentas de la plataforma. Para ver sus organizaciones, busca su correo en Organizaciones." />

      <div className="sm:w-96">
        <Input
          label="Buscar por correo"
          type="search"
          placeholder="nombre@empresa.cl"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      {listQuery.isPending ? (
        <LoadingState label="Buscando usuarios…" />
      ) : listQuery.isError ? (
        <ErrorState onRetry={() => listQuery.refetch()} />
      ) : listQuery.data.items.length === 0 ? (
        <EmptyState
          title={debouncedSearch ? "Ningún usuario coincide" : "Todavía no hay usuarios"}
          description={debouncedSearch ? "Revisa el correo o prueba con una parte de él." : undefined}
        />
      ) : (
        <div className="flex flex-col gap-3" aria-busy={listQuery.isFetching}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Organizaciones</TableHead>
                <TableHead>Alta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.data.items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Link
                      href={`/organizaciones?buscar=${encodeURIComponent(user.email)}`}
                      className="break-all font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {user.email}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      {user.emailVerified ? <Tag>Correo verificado</Tag> : <Tag tone="warning">Sin verificar</Tag>}
                      {user.twoFactorEnabled ? <Tag>2FA</Tag> : null}
                      {user.isSuperAdmin ? <Tag tone="primary">Superadmin</Tag> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatInteger(user.organizations)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
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
