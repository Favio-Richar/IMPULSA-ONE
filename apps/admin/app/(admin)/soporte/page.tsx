"use client";

import type { SupportTicketStatus } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, LoadingState, cn } from "@impulza/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SUPPORT_STATUS_LABELS, SupportStatusBadge } from "../../../components/support-bits";
import { PageHeader, Pagination } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";
import { formatDateTime, formatInteger } from "../../../lib/format";

const PAGE_SIZE = 25;
const TABS: SupportTicketStatus[] = ["OPEN", "ANSWERED", "CLOSED"];

export default function SupportInboxPage(): React.JSX.Element {
  return (
    <Suspense fallback={<LoadingState label="Cargando…" />}>
      <SupportInbox />
    </Suspense>
  );
}

function SupportInbox(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const organizationId = searchParams.get("organizationId") ?? undefined;
  const [status, setStatus] = useState<SupportTicketStatus>("OPEN");
  const [page, setPage] = useState(1);

  const params = { status, organizationId, page, pageSize: PAGE_SIZE };
  const inboxQuery = useQuery({
    queryKey: ["admin", "support", params],
    queryFn: () => adminApi.supportTickets(params),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Soporte"
        description="Solicitudes de los clientes. Las sin responder aparecen de la más antigua a la más nueva: se atienden por orden de llegada."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Estado de las solicitudes" className="inline-flex rounded-md border border-border bg-background p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="radio"
              aria-checked={status === tab}
              onClick={() => {
                setStatus(tab);
                setPage(1);
              }}
              className={cn(
                "flex items-center gap-2 rounded-sm px-3 py-1 text-sm transition-colors",
                status === tab ? "bg-foreground text-background" : "text-foreground hover:bg-surface",
              )}
            >
              {SUPPORT_STATUS_LABELS[tab]}
              {inboxQuery.data ? (
                <span
                  className={cn(
                    "rounded-sm px-1.5 text-xs tabular-nums",
                    status === tab ? "bg-background/20" : tab === "OPEN" && inboxQuery.data.counts.OPEN > 0 ? "bg-warning/15 text-warning" : "bg-surface",
                  )}
                >
                  {formatInteger(inboxQuery.data.counts[tab])}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {organizationId ? (
          <Button variant="secondary" size="sm" onClick={() => router.replace("/soporte")}>
            Solo una organización
            <X className="size-4" aria-label="Quitar filtro" />
          </Button>
        ) : null}
      </div>

      {inboxQuery.isPending ? (
        <LoadingState label="Cargando solicitudes…" />
      ) : inboxQuery.isError ? (
        <ErrorState onRetry={() => inboxQuery.refetch()} />
      ) : inboxQuery.data.items.length === 0 ? (
        <EmptyState
          title={status === "OPEN" ? "Nada pendiente" : `No hay solicitudes ${SUPPORT_STATUS_LABELS[status].toLowerCase()}`}
          description={status === "OPEN" ? "Todas las solicitudes tienen respuesta." : undefined}
        />
      ) : (
        <div className="flex flex-col gap-3" aria-busy={inboxQuery.isFetching}>
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
            {inboxQuery.data.items.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/soporte/${ticket.id}`}
                  className="flex flex-col gap-2 p-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">{ticket.subject}</span>
                    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{ticket.organizationName}</span>
                      {ticket.openedByEmail ? <span className="truncate">{ticket.openedByEmail}</span> : null}
                      <span>Última actividad {formatDateTime(ticket.updatedAt)}</span>
                      <span>
                        {ticket.messageCount} {ticket.messageCount === 1 ? "mensaje" : "mensajes"}
                      </span>
                    </span>
                  </span>
                  <SupportStatusBadge status={ticket.status} />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={inboxQuery.data.total} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
