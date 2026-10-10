"use client";

import type { PagePublishStatusResponse, PublishRequestSummaryResponse } from "@impulza/contracts";
import { PUBLISH_COMMENT_MAX } from "@impulza/validation";
import { Button, Dialog, Textarea } from "@impulza/ui";
import { Check, Clock, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useMe } from "../../lib/hooks/use-me";
import { usePublishPage } from "../../lib/hooks/use-pages";
import { useCancelPublishRequest, usePagePublishStatus, useRequestPublish } from "../../lib/hooks/use-publish";
import { ConfirmButton } from "../confirm-button";

/** El mensaje del servidor (ya viene en español y explica qué hacer); si no hay, el de respaldo. */
export function publishErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const message = (error.body as { message?: unknown }).message;
    if (typeof message === "string" && (error.status === 403 || error.status === 409)) return message;
  }
  return fallback;
}

export interface PublishFlow {
  status: PagePublishStatusResponse | undefined;
  /** La organización exige aprobación y quien consulta no puede aprobar: debe pedirla. */
  mustRequest: boolean;
  /** Texto del botón principal. */
  label: string;
  disabled: boolean;
  busy: boolean;
  /** Lo que hace el botón: publicar, o abrir el pedido de aprobación. */
  act: () => void;
  requestOpen: boolean;
  openRequest: (target?: { versionId: string; versionNumber: number }) => void;
  closeRequest: () => void;
  requestTarget: { versionId: string; versionNumber: number } | null;
  publishMutation: ReturnType<typeof usePublishPage>;
  requestMutation: ReturnType<typeof useRequestPublish>;
  cancelMutation: ReturnType<typeof useCancelPublishRequest>;
}

/**
 * Una sola forma de publicar para todo el panel (editor, detalle de página, salud de la página): si la organización exige
 * aprobación, el botón pide, espera y después publica; si no, publica directo. El servidor decide siempre — esto solo evita
 * ofrecer un botón que respondería 403.
 */
export function usePublishFlow(organizationId: string, siteId: string, pageId: string): PublishFlow {
  const statusQuery = usePagePublishStatus(organizationId, siteId, pageId);
  const publishMutation = usePublishPage(organizationId, siteId, pageId);
  const requestMutation = useRequestPublish(organizationId, siteId, pageId);
  const cancelMutation = useCancelPublishRequest(organizationId);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestTarget, setRequestTarget] = useState<{ versionId: string; versionNumber: number } | null>(null);

  const status = statusQuery.data;
  const mustRequest = status !== undefined && status.approvalRequired && !status.canPublishDirectly;
  const hasApprovedPublish = (status?.approved ?? []).some((request) => request.kind === "PUBLISH");
  const pendingPublish = status?.pending?.kind === "PUBLISH";

  const openRequest = (target?: { versionId: string; versionNumber: number }) => {
    requestMutation.reset();
    setRequestTarget(target ?? null);
    setRequestOpen(true);
  };

  let label = "Publicar";
  let disabled = false;
  let act = () => publishMutation.mutate();
  if (mustRequest && !hasApprovedPublish) {
    if (pendingPublish) {
      label = "Esperando aprobación";
      disabled = true;
    } else {
      label = "Pedir aprobación";
      act = () => openRequest();
    }
  }

  return {
    status,
    mustRequest,
    label,
    disabled,
    busy: publishMutation.isPending,
    act,
    requestOpen,
    openRequest,
    closeRequest: () => setRequestOpen(false),
    requestTarget,
    publishMutation,
    requestMutation,
    cancelMutation,
  };
}

/** El diálogo con que se pide la aprobación (publicar el contenido actual, o volver a una versión). */
export function PublishRequestDialog({ flow }: { flow: PublishFlow }): React.JSX.Element {
  const [comment, setComment] = useState("");
  const target = flow.requestTarget;
  const submit = () => {
    flow.requestMutation.mutate(
      {
        kind: target ? "RESTORE" : "PUBLISH",
        ...(target ? { versionId: target.versionId } : {}),
        comment: comment.trim() === "" ? null : comment.trim(),
      },
      {
        onSuccess: () => {
          setComment("");
          flow.closeRequest();
        },
      },
    );
  };

  return (
    <Dialog
      open={flow.requestOpen}
      onOpenChange={(open) => {
        if (!open) flow.closeRequest();
      }}
      title={target ? `Pedir aprobación para volver a la versión #${target.versionNumber}` : "Pedir aprobación para publicar"}
      description="Quien puede aprobar recibe un aviso y revisa exactamente el contenido de ahora. Si lo cambias después, tendrás que pedirla de nuevo."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={flow.closeRequest}>
            Cancelar
          </Button>
          <Button type="button" loading={flow.requestMutation.isPending} onClick={submit}>
            Enviar solicitud
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea
          label="Comentario (opcional)"
          helperText="Qué cambió o qué debería mirar quien revise."
          maxLength={PUBLISH_COMMENT_MAX}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        {flow.requestMutation.isError ? (
          <p role="alert" className="text-sm text-danger">
            {publishErrorMessage(flow.requestMutation.error, "No pudimos enviar la solicitud. Intenta de nuevo.")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("es") : "";
}

function Who({ person }: { person: PublishRequestSummaryResponse["requestedBy"] }): React.JSX.Element {
  return <strong className="font-medium">{person?.email ?? "Una cuenta eliminada"}</strong>;
}

/**
 * Qué pasa con la página ahora: pendiente, aprobada, rechazada (con el motivo) o simplemente «aquí se aprueba antes de publicar».
 * No muestra nada si la organización no exige aprobación.
 */
export function PublishNotice({ flow }: { flow: PublishFlow }): React.JSX.Element | null {
  const meQuery = useMe();
  const status = flow.status;
  if (!status || !status.approvalRequired) return null;

  const pending = status.pending;
  const approvedPublish = status.approved.find((request) => request.kind === "PUBLISH");
  const rejected = status.lastResolved?.status === "REJECTED" && !pending && !approvedPublish ? status.lastResolved : null;
  const mine = pending !== null && pending.requestedBy?.id === meQuery.data?.id;

  let tone = "border-border bg-surface text-foreground";
  let icon = <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />;
  let body: React.ReactNode;
  if (approvedPublish) {
    tone = "border-success/40 bg-success/10 text-foreground";
    icon = <Check className="size-4 shrink-0 text-success" aria-hidden="true" />;
    body = (
      <>
        <Who person={approvedPublish.reviewedBy} /> aprobó esta página el {when(approvedPublish.reviewedAt)}. Ya puedes publicarla
        {approvedPublish.reviewComment ? `: «${approvedPublish.reviewComment}»` : "."}
      </>
    );
  } else if (pending) {
    icon = <Clock className="size-4 shrink-0" aria-hidden="true" />;
    body = (
      <>
        Solicitud enviada por <Who person={pending.requestedBy} /> el {when(pending.createdAt)}. Está esperando que la revise alguien con
        permiso para aprobar.
      </>
    );
  } else if (rejected) {
    tone = "border-danger/40 bg-danger/10 text-foreground";
    icon = <XCircle className="size-4 shrink-0 text-danger" aria-hidden="true" />;
    body = (
      <>
        <Who person={rejected.reviewedBy} /> rechazó la solicitud: «{rejected.reviewComment ?? "sin comentario"}». Corrige lo indicado y
        pídela de nuevo.
      </>
    );
  } else {
    body = status.canPublishDirectly
      ? "Esta organización exige aprobación antes de publicar. Tú puedes aprobar, así que publicas directo."
      : "Esta organización exige aprobación antes de publicar: pídela y espera a que la aprueben.";
  }

  return (
    <div role="status" className={`flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${tone}`}>
      <p className="flex items-start gap-2">
        {icon}
        <span>{body}</span>
      </p>
      {pending && mine ? (
        <ConfirmButton
          variant="ghost"
          size="sm"
          confirmLabel="¿Cancelar la solicitud?"
          loading={flow.cancelMutation.isPending}
          onConfirm={() => flow.cancelMutation.mutate(pending.id)}
        >
          Cancelar solicitud
        </ConfirmButton>
      ) : null}
    </div>
  );
}

/** Texto de error de la publicación (403 por aprobación, o genérico). */
export function PublishErrorText({ flow }: { flow: PublishFlow }): React.JSX.Element | null {
  if (!flow.publishMutation.isError) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {publishErrorMessage(flow.publishMutation.error, "No pudimos publicar. Intenta de nuevo.")}
    </p>
  );
}
