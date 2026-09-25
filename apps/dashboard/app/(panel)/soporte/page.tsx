"use client";

import { Button, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { SupportStatusBadge, formatSupportDate } from "../../../components/support-thread";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { useSupportTickets } from "../../../lib/hooks/use-support";

export default function SoportePage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus solicitudes de soporte." />;
  }
  return <SupportList organizationId={activeOrganizationId} />;
}

function SupportList({ organizationId }: { organizationId: string }): React.JSX.Element {
  const ticketsQuery = useSupportTickets(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">Soporte</h1>
          <p className="text-sm text-muted-foreground">
            ¿Algo no funciona o tienes una duda? Escríbenos y te respondemos aquí mismo; también te avisamos por correo.
          </p>
        </div>
        <Button asChild>
          <Link href="/soporte/nueva">
            <Plus className="size-4" aria-hidden="true" />
            Nueva solicitud
          </Link>
        </Button>
      </div>

      {ticketsQuery.isPending ? (
        <LoadingState label="Cargando tus solicitudes…" />
      ) : ticketsQuery.isError ? (
        <ErrorState onRetry={() => ticketsQuery.refetch()} />
      ) : ticketsQuery.data.length === 0 ? (
        <EmptyState
          title="Todavía no tienes solicitudes"
          description="Cuando nos escribas, verás aquí el estado de cada solicitud y nuestras respuestas."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/soporte/nueva">Escribir al equipo</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
          {ticketsQuery.data.map((ticket) => (
            <li key={ticket.id}>
              <Link
                href={`/soporte/${ticket.id}`}
                className="flex flex-col gap-2 p-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">{ticket.subject}</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Actualizada {formatSupportDate(ticket.updatedAt)}</span>
                    <span className="flex items-center gap-1">
                      <MessagesSquare className="size-3.5" aria-hidden="true" />
                      {ticket.messageCount} {ticket.messageCount === 1 ? "mensaje" : "mensajes"}
                    </span>
                    {ticket.openedByEmail ? <span className="truncate">Abierta por {ticket.openedByEmail}</span> : null}
                  </span>
                </span>
                <SupportStatusBadge status={ticket.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
