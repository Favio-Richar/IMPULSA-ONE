"use client";

import { Button, EmptyState, ErrorState, LoadingState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@impulza/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PageHeader, Pagination } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";
import { AUDIT_ACTION_LABELS, formatDateTime } from "../../../lib/format";

const PAGE_SIZE = 30;

export default function AuditPage(): React.JSX.Element {
  return (
    <Suspense fallback={<LoadingState label="Cargando…" />}>
      <AuditList />
    </Suspense>
  );
}

/** Resumen de una línea de `metadata`: el motivo si lo hay; si no, las claves simples. Nunca hay
 *  secretos en `metadata` (lo garantiza `AuditService`), pero igual se muestra acotado. */
function describeMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) {
    return null;
  }
  if (typeof metadata.reason === "string") {
    return `“${metadata.reason}”`;
  }
  const simple = Object.entries(metadata)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return simple.length > 0 ? simple.join(" · ") : null;
}

function AuditList(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const organizationId = searchParams.get("organizationId") ?? undefined;
  const [scope, setScope] = useState<"admin" | "all">("admin");
  const [page, setPage] = useState(1);

  const params = { scope, organizationId, page, pageSize: PAGE_SIZE };
  const auditQuery = useQuery({
    queryKey: ["admin", "audit", params],
    queryFn: () => adminApi.audit(params),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Auditoría"
        description="Quién hizo qué y cuándo. Las acciones de administración siempre quedan con el nombre de quien las hizo."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Qué acciones mostrar" className="inline-flex rounded-md border border-border bg-background p-0.5">
          {(
            [
              ["admin", "Administración"],
              ["all", "Toda la plataforma"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              onClick={() => {
                setScope(value);
                setPage(1);
              }}
              className={cn("rounded-sm px-3 py-1 text-sm transition-colors", scope === value ? "bg-foreground text-background" : "text-foreground hover:bg-surface")}
            >
              {label}
            </button>
          ))}
        </div>
        {organizationId ? (
          <Button variant="secondary" size="sm" onClick={() => router.replace("/auditoria")}>
            Solo una organización
            <X className="size-4" aria-label="Quitar filtro" />
          </Button>
        ) : null}
      </div>

      {auditQuery.isPending ? (
        <LoadingState label="Cargando auditoría…" />
      ) : auditQuery.isError ? (
        <ErrorState onRetry={() => auditQuery.refetch()} />
      ) : auditQuery.data.items.length === 0 ? (
        <EmptyState title="No hay acciones registradas" description={organizationId ? "Esta organización no tiene acciones con este filtro." : undefined} />
      ) : (
        <div className="flex flex-col gap-3" aria-busy={auditQuery.isFetching}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuándo</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Quién</TableHead>
                <TableHead>Organización</TableHead>
                <TableHead>Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditQuery.data.items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell className="font-medium text-foreground">{AUDIT_ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                  <TableCell className="break-all">{entry.actorEmail ?? <span className="text-muted-foreground">Sistema</span>}</TableCell>
                  <TableCell>
                    {entry.organizationId ? (
                      <Link href={`/organizaciones/${entry.organizationId}`} className="text-primary hover:underline">
                        {entry.organizationName ?? "Ver"}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 text-muted-foreground">{describeMetadata(entry.metadata) ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={auditQuery.data.total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
