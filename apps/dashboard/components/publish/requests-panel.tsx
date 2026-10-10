"use client";

import type { PublishRequestSummaryResponse } from "@impulza/contracts";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, EmptyState, ErrorState, LoadingState, Select, Textarea, cn } from "@impulza/ui";
import { PUBLISH_COMMENT_MAX, isBlockType, type PublishRequestStatusValue } from "@impulza/validation";
import { Check, Clock, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BLOCK_LABELS } from "../../lib/block-fields/labels";
import { useMe } from "../../lib/hooks/use-me";
import {
  useApprovePublishRequest,
  usePublishRequest,
  usePublishRequests,
  usePublishSettings,
  useRejectPublishRequest,
} from "../../lib/hooks/use-publish";
import { publishErrorMessage } from "./publish-flow";

const PAGE_SIZE = 10;

const STATUS_FILTERS: Array<{ value: PublishRequestStatusValue | "ALL"; label: string }> = [
  { value: "PENDING", label: "Pendientes" },
  { value: "APPROVED", label: "Aprobadas" },
  { value: "REJECTED", label: "Rechazadas" },
  { value: "CANCELLED", label: "Canceladas" },
  { value: "ALL", label: "Todas" },
];

const STATUS_VIEW: Record<PublishRequestStatusValue, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  PENDING: { label: "Pendiente", className: "border-warning/50 bg-warning/10 text-foreground", icon: Clock },
  APPROVED: { label: "Aprobada", className: "border-success/50 bg-success/10 text-foreground", icon: Check },
  REJECTED: { label: "Rechazada", className: "border-danger/50 bg-danger/10 text-foreground", icon: XCircle },
  CANCELLED: { label: "Cancelada", className: "border-border bg-surface text-muted-foreground", icon: XCircle },
};

function StatusBadge({ request }: { request: PublishRequestSummaryResponse }): React.JSX.Element {
  const view = STATUS_VIEW[request.status];
  const Icon = view.icon;
  // Una aprobada que ya se usó es «Publicada»: es lo que quien pidió quiere saber.
  const label = request.status === "APPROVED" && request.consumedAt ? "Publicada" : view.label;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", view.className)}>
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function kindText(request: PublishRequestSummaryResponse): string {
  return request.kind === "RESTORE" ? `Volver a la versión #${request.targetVersionNumber ?? "?"}` : "Publicar los cambios";
}

function dateText(iso: string): string {
  return new Date(iso).toLocaleString("es");
}

/** La cola y el historial de solicitudes de publicación de la organización (F9.6c). */
export function PublishRequestsPanel({ organizationId }: { organizationId: string }): React.JSX.Element {
  const [filter, setFilter] = useState<PublishRequestStatusValue | "ALL">("PENDING");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = usePublishRequests(organizationId, { ...(filter === "ALL" ? {} : { status: filter }), limit: PAGE_SIZE, offset });

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>Solicitudes de publicación</CardTitle>
          <CardDescription>Quién pidió publicar qué, y qué se resolvió. Cada aprobación vale para el contenido que se revisó.</CardDescription>
        </div>
        <div className="w-full sm:w-48">
          <Select
            label="Mostrar"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as PublishRequestStatusValue | "ALL");
              setOffset(0);
            }}
            options={STATUS_FILTERS}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending ? (
          <LoadingState label="Cargando solicitudes…" />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            title={filter === "PENDING" ? "No hay solicitudes pendientes" : "No hay solicitudes con este filtro"}
            description={
              filter === "PENDING"
                ? "Cuando alguien del equipo pida publicar una página, aparecerá aquí para que la revises."
                : "Prueba con otro estado."
            }
          />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border" data-testid="publish-request-list">
              {query.data.items.map((request) => (
                <li key={request.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="publish-request-row">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {request.siteName} / {request.pageSlug}
                      </span>
                      <StatusBadge request={request} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {kindText(request)} · pidió {request.requestedBy?.email ?? "una cuenta eliminada"} · {dateText(request.createdAt)}
                    </span>
                    {request.requestComment ? <span className="truncate text-xs text-muted-foreground">«{request.requestComment}»</span> : null}
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setOpenId(request.id)}>
                    {request.status === "PENDING" ? "Revisar" : "Ver"}
                  </Button>
                </li>
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
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={offset + PAGE_SIZE >= query.data.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Siguiente
                </Button>
              </span>
            </div>
          </>
        )}
      </CardContent>
      <RequestDialog organizationId={organizationId} requestId={openId} onClose={() => setOpenId(null)} />
    </Card>
  );
}

function RequestDialog({
  organizationId,
  requestId,
  onClose,
}: {
  organizationId: string;
  requestId: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const detail = usePublishRequest(organizationId, requestId);
  const settings = usePublishSettings(organizationId);
  const meQuery = useMe();
  const approve = useApprovePublishRequest(organizationId);
  const reject = useRejectPublishRequest(organizationId);
  const [comment, setComment] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const close = () => {
    setComment("");
    setRejecting(false);
    approve.reset();
    reject.reset();
    onClose();
  };

  const request = detail.data;
  const mine = request !== undefined && request.requestedBy?.id === meQuery.data?.id;
  const canReview = request?.status === "PENDING" && settings.data?.canApprove === true && !mine;
  const error = approve.isError
    ? publishErrorMessage(approve.error, "No pudimos aprobar la solicitud.")
    : reject.isError
      ? publishErrorMessage(reject.error, "No pudimos rechazar la solicitud.")
      : null;
  const rejectTooShort = rejecting && comment.trim().length < 3;

  return (
    <Dialog
      open={requestId !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      size="lg"
      title={request ? `${request.siteName} / ${request.pageSlug}` : "Solicitud de publicación"}
      description={request ? kindText(request) : undefined}
      footer={
        canReview ? (
          rejecting ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                Volver
              </Button>
              <Button
                type="button"
                variant="destructive"
                loading={reject.isPending}
                disabled={rejectTooShort}
                onClick={() => reject.mutate({ requestId: request.id, comment: comment.trim() }, { onSuccess: close })}
              >
                Rechazar solicitud
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>
                Rechazar
              </Button>
              <Button
                type="button"
                loading={approve.isPending}
                onClick={() => approve.mutate({ requestId: request.id, comment: comment.trim() === "" ? null : comment.trim() }, { onSuccess: close })}
              >
                Aprobar
              </Button>
            </>
          )
        ) : undefined
      }
    >
      {detail.isPending && requestId !== null ? (
        <LoadingState label="Cargando la solicitud…" />
      ) : detail.isError ? (
        <ErrorState onRetry={() => void detail.refetch()} />
      ) : request ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge request={request} />
            <span className="text-sm text-muted-foreground">
              Pidió {request.requestedBy?.email ?? "una cuenta eliminada"} el {dateText(request.createdAt)}
            </span>
          </div>
          {request.requestComment ? <p className="rounded-md bg-surface p-3 text-sm text-foreground">«{request.requestComment}»</p> : null}

          {request.contentIsCurrent === false && request.status !== "APPROVED" ? (
            <p role="status" className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-foreground">
              La página cambió después de esta solicitud. Lo que aprobarías es el contenido de abajo, no el que hay ahora en el editor.
            </p>
          ) : null}

          <section className="flex flex-col gap-2" aria-label="Contenido solicitado">
            <h3 className="text-sm font-semibold text-foreground">Contenido que se pidió publicar</h3>
            <p className="text-xs text-muted-foreground">
              Dirección: /{request.content.slug} · {request.content.visibility === "PUBLIC" ? "Pública" : "Oculta"}
              {typeof (request.content.seoMeta as { title?: unknown } | null)?.title === "string"
                ? ` · Título SEO: ${(request.content.seoMeta as { title: string }).title}`
                : ""}
            </p>
            {request.content.blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">La página no tiene bloques.</p>
            ) : (
              <ol className="flex flex-col gap-1">
                {request.content.blocks.map((block) => (
                  <li key={block.position} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <span>
                      {block.position + 1}. {isBlockType(block.type) ? BLOCK_LABELS[block.type] : block.type}
                    </span>
                    {block.visible ? null : <span className="text-xs text-muted-foreground">Oculto</span>}
                  </li>
                ))}
              </ol>
            )}
            {request.status === "PENDING" ? (
              <Link
                href={`/sitios/${request.siteId}/paginas/${request.pageId}/editor`}
                className="self-start text-sm text-primary underline underline-offset-2"
              >
                Abrir la página en el editor
              </Link>
            ) : null}
          </section>

          {request.status !== "PENDING" ? (
            <section className="flex flex-col gap-1 border-t border-border pt-3 text-sm" aria-label="Resolución">
              <span className="text-foreground">
                {request.status === "CANCELLED" && !request.reviewedBy ? "Cancelada" : STATUS_VIEW[request.status].label}
                {request.reviewedBy ? ` por ${request.reviewedBy.email}` : ""}
                {request.reviewedAt ? ` el ${dateText(request.reviewedAt)}` : ""}
              </span>
              {request.reviewComment ? <span className="text-muted-foreground">«{request.reviewComment}»</span> : null}
              {request.consumedAt ? (
                <span className="text-muted-foreground">
                  Publicada el {dateText(request.consumedAt)}
                  {request.publishedVersionNumber ? ` como versión #${request.publishedVersionNumber}` : ""}.
                </span>
              ) : null}
            </section>
          ) : null}

          {canReview ? (
            <Textarea
              label={rejecting ? "Motivo del rechazo" : "Comentario (opcional)"}
              helperText={rejecting ? "Obligatorio: explica qué debe corregirse." : undefined}
              maxLength={PUBLISH_COMMENT_MAX}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              required={rejecting}
            />
          ) : request.status === "PENDING" ? (
            <p className="text-sm text-muted-foreground">
              {mine
                ? "Es tu solicitud: la resuelve otra persona con permiso para aprobar."
                : "No tienes permiso para aprobar solicitudes de publicación."}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
