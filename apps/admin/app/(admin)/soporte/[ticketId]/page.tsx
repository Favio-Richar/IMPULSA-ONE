"use client";

import type { AdminSupportTicketDetailResponse } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, LoadingState, Textarea } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { SupportStatusBadge, SupportThread } from "../../../../components/support-bits";
import { PageHeader, Section } from "../../../../components/ui-bits";
import { ApiError } from "../../../../lib/api-client";
import { adminApi } from "../../../../lib/api";
import { formatDateTime } from "../../../../lib/format";

type Detail = AdminSupportTicketDetailResponse;

export default function SupportTicketPage(): React.JSX.Element {
  const { ticketId } = useParams<{ ticketId: string }>();
  const ticketQuery = useQuery({ queryKey: ["admin", "support-ticket", ticketId], queryFn: () => adminApi.supportTicket(ticketId), retry: false });

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
        {notFound ? <EmptyState title="No encontramos esa solicitud" /> : <ErrorState onRetry={() => ticketQuery.refetch()} />}
      </div>
    );
  }

  const ticket = ticketQuery.data;

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        title={ticket.subject}
        description={`Abierta el ${formatDateTime(ticket.createdAt)}${ticket.openedByEmail ? ` por ${ticket.openedByEmail}` : ""}`}
        actions={<SupportStatusBadge status={ticket.status} />}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <SupportThread messages={ticket.messages} />
          {ticket.status === "CLOSED" ? (
            <p className="flex gap-2 rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Cerrada{ticket.closedAt ? ` el ${formatDateTime(ticket.closedAt)}` : ""}. El cliente puede abrir una nueva si necesita algo más.
            </p>
          ) : (
            <StaffReply ticket={ticket} />
          )}
        </div>

        <Section title="Organización" className="xl:self-start">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">Nombre</dt>
              <dd className="font-medium text-foreground">{ticket.organizationName}</dd>
            </div>
            {ticket.openedByEmail ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-muted-foreground">Abierta por</dt>
                <dd className="break-all text-foreground">{ticket.openedByEmail}</dd>
              </div>
            ) : null}
          </dl>
          <div className="flex flex-col gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/organizaciones/${ticket.organizationId}`}>Ver organización</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/soporte?organizationId=${ticket.organizationId}`}>Otras solicitudes de esta organización</Link>
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function StaffReply({ ticket }: { ticket: Detail }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  function apply(detail: Detail): void {
    queryClient.setQueryData(["admin", "support-ticket", ticket.id], detail);
    void queryClient.invalidateQueries({ queryKey: ["admin", "support"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
  }

  const replyMutation = useMutation({
    mutationFn: () => adminApi.replySupportTicket(ticket.id, body.trim()),
    onSuccess: (detail) => {
      apply(detail);
      setBody("");
    },
  });
  const closeMutation = useMutation({ mutationFn: () => adminApi.closeSupportTicket(ticket.id), onSuccess: apply });
  const failure = replyMutation.error ?? closeMutation.error;

  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim().length < 10) {
          setError("Escribe una respuesta de al menos 10 caracteres.");
          return;
        }
        setError(null);
        replyMutation.mutate();
      }}
    >
      <Textarea
        label="Respuesta al cliente"
        rows={5}
        maxLength={5000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        error={error ?? undefined}
        helperText="El cliente la ve firmada como “Equipo de Impulza One” y recibe un aviso por correo (sin el texto)."
      />
      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {failure instanceof ApiError ? failure.messageOr("No se pudo completar la acción.") : "No se pudo completar la acción."}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        {confirmClose ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-foreground">¿Cerrar sin responder más?</span>
            <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmClose(false)}>
              No
            </Button>
            <Button type="button" size="sm" loading={closeMutation.isPending} onClick={() => closeMutation.mutate()}>
              Sí, cerrar
            </Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setConfirmClose(true)}>
            Cerrar solicitud
          </Button>
        )}
        <Button type="submit" loading={replyMutation.isPending}>
          Enviar respuesta
        </Button>
      </div>
    </form>
  );
}
