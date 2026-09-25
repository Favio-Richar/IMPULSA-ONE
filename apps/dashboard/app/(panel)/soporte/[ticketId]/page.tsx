"use client";

import { Button, EmptyState, ErrorState, LoadingState, Textarea } from "@impulza/ui";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { SupportStatusBadge, SupportThread, formatSupportDate } from "../../../../components/support-thread";
import { ApiError } from "../../../../lib/api-client";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { useReplySupportTicket, useSupportTicket } from "../../../../lib/hooks/use-support";

export default function SolicitudPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const { ticketId } = useParams<{ ticketId: string }>();
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver esta solicitud." />;
  }
  return <TicketView organizationId={activeOrganizationId} ticketId={ticketId} />;
}

function TicketView({ organizationId, ticketId }: { organizationId: string; ticketId: string }): React.JSX.Element {
  const ticketQuery = useSupportTicket(organizationId, ticketId);

  const back = (
    <Link href="/soporte" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Soporte
    </Link>
  );

  if (ticketQuery.isPending) {
    return <LoadingState label="Cargando la solicitud…" />;
  }
  if (ticketQuery.isError) {
    const notFound = ticketQuery.error instanceof ApiError && (ticketQuery.error.status === 404 || ticketQuery.error.status === 400);
    return (
      <div className="flex flex-col gap-6">
        {back}
        {notFound ? (
          <EmptyState title="No encontramos esta solicitud" description="Puede ser de otra organización o de otra persona de tu equipo." />
        ) : (
          <ErrorState onRetry={() => ticketQuery.refetch()} />
        )}
      </div>
    );
  }

  const ticket = ticketQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {back}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="break-words text-lg font-semibold text-foreground">{ticket.subject}</h1>
          <p className="text-sm text-muted-foreground">
            Abierta el {formatSupportDate(ticket.createdAt)}
            {ticket.openedByEmail ? ` por ${ticket.openedByEmail}` : ""}
          </p>
        </div>
        <SupportStatusBadge status={ticket.status} />
      </div>

      <SupportThread messages={ticket.messages} />

      {ticket.status === "CLOSED" ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex gap-2 text-muted-foreground">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            El equipo cerró esta solicitud{ticket.closedAt ? ` el ${formatSupportDate(ticket.closedAt)}` : ""}. Si necesitas más ayuda, abre una nueva.
          </p>
          <Button asChild variant="secondary" size="sm">
            <Link href="/soporte/nueva">Nueva solicitud</Link>
          </Button>
        </div>
      ) : (
        <ReplyForm organizationId={organizationId} ticketId={ticketId} />
      )}
    </div>
  );
}

function ReplyForm({ organizationId, ticketId }: { organizationId: string; ticketId: string }): React.JSX.Element {
  const replyMutation = useReplySupportTicket(organizationId, ticketId);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim().length < 10) {
          setError("Cuéntanos un poco más (al menos 10 caracteres).");
          return;
        }
        setError(null);
        replyMutation.mutate(body.trim(), { onSuccess: () => setBody("") });
      }}
    >
      <Textarea label="Tu respuesta" rows={4} maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} error={error ?? undefined} />
      {replyMutation.isError ? (
        <p role="alert" className="text-sm text-danger">
          {replyMutation.error instanceof ApiError && replyMutation.error.status === 409
            ? "El equipo acaba de cerrar esta solicitud. Recarga la página para verla."
            : "No pudimos enviar tu respuesta. Intenta de nuevo."}
        </p>
      ) : null}
      <Button type="submit" loading={replyMutation.isPending} className="w-full sm:w-auto sm:self-end">
        Enviar respuesta
      </Button>
    </form>
  );
}
