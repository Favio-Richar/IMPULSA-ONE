"use client";

import type { AdminAbuseReportResponse } from "@impulza/contracts";
import { ABUSE_REPORT_REASON_LABELS, type AbuseReportReason } from "@impulza/validation";
import { Button, EmptyState, ErrorState, LoadingState, cn } from "@impulza/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ModerationStatusBadge } from "../../../components/moderation-bits";
import { PageHeader, Pagination } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";
import { formatDateTime, formatInteger } from "../../../lib/format";

const PAGE_SIZE = 25;
const TABS = [
  { value: "QUEUE", label: "Por revisar" },
  { value: "ALL", label: "Historial" },
] as const;
const SORTS = [
  { value: "priority", label: "Prioridad" },
  { value: "oldest", label: "Más antiguos" },
  { value: "newest", label: "Más recientes" },
] as const;

export default function ModerationQueuePage(): React.JSX.Element {
  return (
    <Suspense fallback={<LoadingState label="Cargando…" />}>
      <ModerationQueue />
    </Suspense>
  );
}

function ModerationQueue(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const organizationId = searchParams.get("organizationId") ?? undefined;
  const [status, setStatus] = useState<"QUEUE" | "ALL">("QUEUE");
  const [reason, setReason] = useState<AbuseReportReason | "">("");
  const [sort, setSort] = useState<"priority" | "oldest" | "newest">("priority");
  const [page, setPage] = useState(1);

  const params = { status, reason: reason || undefined, sort: status === "QUEUE" ? sort : sort === "priority" ? "newest" : sort, organizationId, page, pageSize: PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: ["admin", "abuse-reports", params],
    queryFn: () => adminApi.abuseReports(params),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Moderación"
        description="Reportes de abuso sobre páginas públicas. Un reporte nunca despublica nada por sí solo: la decisión es siempre de una persona, con motivo y auditoría."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Qué casos ver" className="inline-flex rounded-md border border-border bg-background p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="radio"
              aria-checked={status === tab.value}
              onClick={() => {
                setStatus(tab.value);
                setPage(1);
              }}
              className={cn(
                "flex items-center gap-2 rounded-sm px-3 py-1 text-sm transition-colors",
                status === tab.value ? "bg-foreground text-background" : "text-foreground hover:bg-surface",
              )}
            >
              {tab.label}
              {tab.value === "QUEUE" && listQuery.data ? (
                <span className={cn("rounded-sm px-1.5 text-xs tabular-nums", status === "QUEUE" ? "bg-background/20" : listQuery.data.queueSize > 0 ? "bg-warning/15 text-warning" : "bg-surface")}>
                  {formatInteger(listQuery.data.queueSize)}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Motivo
          <select
            value={reason}
            onChange={(event) => {
              setReason(event.target.value as AbuseReportReason | "");
              setPage(1);
            }}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="">Todos</option>
            {(Object.keys(ABUSE_REPORT_REASON_LABELS) as AbuseReportReason[]).map((key) => (
              <option key={key} value={key}>
                {ABUSE_REPORT_REASON_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Orden
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as typeof sort);
              setPage(1);
            }}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            {SORTS.filter((item) => status === "QUEUE" || item.value !== "priority").map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {organizationId ? (
          <Button variant="secondary" size="sm" onClick={() => router.replace("/moderacion")}>
            Solo una organización
            <X className="size-4" aria-label="Quitar filtro" />
          </Button>
        ) : null}
      </div>

      {listQuery.isPending ? (
        <LoadingState label="Cargando reportes…" />
      ) : listQuery.isError ? (
        <ErrorState onRetry={() => listQuery.refetch()} />
      ) : listQuery.data.items.length === 0 ? (
        <EmptyState
          title={status === "QUEUE" ? "Nada por revisar" : "Sin reportes"}
          description={status === "QUEUE" ? "No hay reportes abiertos ni apelaciones pendientes." : "Todavía no hay reportes con estos filtros."}
        />
      ) : (
        <div className="flex flex-col gap-3" aria-busy={listQuery.isFetching}>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
            {listQuery.data.items.map((item) => (
              <ReportRow key={item.id} item={item} />
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={listQuery.data.total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}

function ReportRow({ item }: { item: AdminAbuseReportResponse }): React.JSX.Element {
  return (
    <li>
      <Link
        href={`/moderacion/${item.id}`}
        className="flex flex-col gap-2 p-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">
            {ABUSE_REPORT_REASON_LABELS[item.reason]} · {item.site.name}
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{item.organization.name}</span>
            <span>{formatDateTime(item.createdAt)}</span>
            {item.siteOpenReports > 1 ? <span className="font-medium text-warning">{item.siteOpenReports} reportes abiertos en este sitio</span> : null}
            {item.site.hidden ? <span>Sitio despublicado</span> : null}
            {item.organization.blocked ? <span>Organización bloqueada</span> : null}
          </span>
        </span>
        <ModerationStatusBadge status={item.status} />
      </Link>
    </li>
  );
}
