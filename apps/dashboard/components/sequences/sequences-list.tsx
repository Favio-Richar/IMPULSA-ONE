"use client";

import type { EmailSequenceResponse } from "@impulza/contracts";
import {
  AUTOMATION_TRIGGER_LABELS,
  describeDelay,
  MAX_SEQUENCES_PER_ORGANIZATION,
  SEQUENCE_ENROLLMENT_STATUS_LABELS,
  SEQUENCE_STOP_REASON_LABELS,
  type AutomationTrigger,
  type SequenceStopReason,
} from "@impulza/validation";
import { Button, buttonVariants, cn, Dialog, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { History, ListOrdered, Mail, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useSequenceEnrollments, useSequences, useStopEnrollment, useUpdateSequence } from "../../lib/hooks/use-sequences";
import { ConfirmButton } from "../confirm-button";

const DATE_TIME = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "Al instante → 3 días → 1 semana": cuándo sale cada correo, contado desde el evento. */
function cadence(sequence: EmailSequenceResponse): string {
  let total = 0;
  return sequence.steps
    .map((step) => {
      total += step.delayHours;
      return total === 0 ? "al instante" : describeDelay(total);
    })
    .join(" → ");
}

/**
 * Secuencias de correo (F7.5, ADR-020): cada una con su disparador, su recorrido, cuántas personas
 * van en curso y cuántos correos salieron en 30 días; encender o apagar sin perder inscripciones.
 */
export function SequencesList({ organizationId }: { organizationId: string }): React.JSX.Element {
  const query = useSequences(organizationId);
  const [historyOf, setHistoryOf] = useState<EmailSequenceResponse | null>(null);
  const full = (query.data?.length ?? 0) >= MAX_SEQUENCES_PER_ORGANIZATION;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-lg font-semibold text-foreground">Secuencias de correo</h1>
          <p className="text-sm text-muted-foreground">
            Correos que salen solos, en el momento justo: una bienvenida al suscribirse, consejos a los pocos días, un seguimiento después de una reserva o un pedido.
            Solo llegan a quien aceptó recibir correos, y cada uno trae su enlace de baja.
          </p>
        </div>
        {full ? (
          <span className={cn(buttonVariants({ size: "sm" }), "pointer-events-none opacity-60")} aria-disabled="true">
            <Plus className="size-4" aria-hidden="true" />
            Nueva secuencia
          </span>
        ) : (
          <Link href="/secuencias/nueva" className={buttonVariants({ size: "sm" })}>
            <Plus className="size-4" aria-hidden="true" />
            Nueva secuencia
          </Link>
        )}
      </div>

      {query.isPending ? (
        <LoadingState label="Cargando secuencias…" />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          title="Todavía no hay secuencias"
          description="Por ejemplo: cuando alguien confirma su suscripción a la newsletter, una bienvenida al instante y tus productos más pedidos a los 3 días."
          action={
            <Link href="/secuencias/nueva" className={buttonVariants({ size: "sm" })}>
              Crear la primera
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Secuencias">
          {query.data.map((sequence) => (
            <SequenceRow key={sequence.id} organizationId={organizationId} sequence={sequence} onHistory={() => setHistoryOf(sequence)} />
          ))}
        </ul>
      )}
      {full ? <p className="text-sm text-muted-foreground">Llegaste al máximo de {MAX_SEQUENCES_PER_ORGANIZATION} secuencias. Borra una que ya no uses para crear otra.</p> : null}
      {historyOf ? <EnrollmentsDialog organizationId={organizationId} sequence={historyOf} onClose={() => setHistoryOf(null)} /> : null}
    </div>
  );
}

function SequenceRow({ organizationId, sequence, onHistory }: { organizationId: string; sequence: EmailSequenceResponse; onHistory: () => void }): React.JSX.Element {
  const update = useUpdateSequence(organizationId);
  const enabled = update.isPending && update.variables.changes.enabled !== undefined ? update.variables.changes.enabled : sequence.enabled;
  const toggleId = `sequence-${sequence.id}-enabled`;
  const trigger = AUTOMATION_TRIGGER_LABELS[sequence.trigger as AutomationTrigger] ?? sequence.trigger;

  return (
    <li className={cn("flex flex-col gap-3 rounded-lg border border-border bg-background p-4 shadow-xs", !enabled && "bg-surface")} aria-label={sequence.name}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-md", enabled ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground")}>
            <ListOrdered className="size-4" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <Link href={`/secuencias/${sequence.id}`} className="font-medium text-foreground hover:underline">
              {sequence.name}
            </Link>
            <p className="text-sm text-muted-foreground">
              {trigger} · {sequence.steps.length} {sequence.steps.length === 1 ? "correo" : "correos"}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{cadence(sequence)}</span>
            </p>
          </div>
        </div>
        <label htmlFor={toggleId} className="flex shrink-0 cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            id={toggleId}
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={enabled}
            aria-busy={update.isPending || undefined}
            onChange={(event) => {
              if (!update.isPending) update.mutate({ sequenceId: sequence.id, changes: { enabled: event.target.checked } });
            }}
          />
          <span
            aria-hidden="true"
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-focus-ring)] peer-focus-visible:ring-offset-2",
              enabled ? "border-primary bg-primary" : "border-muted-foreground bg-muted-foreground",
            )}
          >
            <span className={cn("inline-block size-4 rounded-full bg-background shadow-xs transition-transform", enabled ? "translate-x-6" : "translate-x-1")} />
          </span>
          <span className="w-20">{enabled ? "Encendida" : "Pausada"}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs tabular-nums text-muted-foreground">
          {sequence.stats.active} en curso · {sequence.stats.completed} completadas · {sequence.stats.sentLast30Days} correos en 30 días
          {sequence.stats.stopped > 0 ? ` · ${sequence.stats.stopped} detenidas` : ""}
        </p>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onHistory}>
            <History className="size-4" aria-hidden="true" />
            Personas
          </Button>
          <Link href={`/secuencias/${sequence.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
            Editar
          </Link>
        </div>
      </div>
      {update.isError ? (
        <p role="alert" className="text-sm text-danger">
          {update.error instanceof ApiError && update.error.status === 403 ? "Tu rol no permite cambiar secuencias." : "No pudimos guardar el cambio. Intenta de nuevo."}
        </p>
      ) : null}
    </li>
  );
}

function EnrollmentsDialog({ organizationId, sequence, onClose }: { organizationId: string; sequence: EmailSequenceResponse; onClose: () => void }): React.JSX.Element {
  const enrollments = useSequenceEnrollments(organizationId, sequence.id);
  const stop = useStopEnrollment(organizationId, sequence.id);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())} title={`Personas · ${sequence.name}`} description="Las últimas 50 que entraron, con su avance." size="lg">
      {enrollments.isPending ? (
        <LoadingState label="Cargando…" />
      ) : enrollments.isError ? (
        <ErrorState onRetry={() => void enrollments.refetch()} />
      ) : enrollments.data.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Todavía no entra nadie. Aparecerán acá cuando ocurra el evento.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Inscripciones">
          {enrollments.data.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">{row.contact.name ?? row.contact.email ?? "Sin nombre"}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {row.sentSteps} de {sequence.steps.length} correos · entró el {DATE_TIME.format(new Date(row.enrolledAt))}
                  {row.status === "ACTIVE" && row.nextSendAt ? ` · próximo: ${DATE_TIME.format(new Date(row.nextSendAt))}` : ""}
                </span>
                {row.stopReason ? <span className="text-xs text-muted-foreground">{SEQUENCE_STOP_REASON_LABELS[row.stopReason as SequenceStopReason] ?? row.stopReason}</span> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-xs font-medium",
                    row.status === "ACTIVE" && "bg-primary/10 text-primary",
                    row.status === "COMPLETED" && "bg-success/10 text-success",
                    row.status === "STOPPED" && "bg-surface text-muted-foreground",
                  )}
                >
                  {SEQUENCE_ENROLLMENT_STATUS_LABELS[row.status]}
                </span>
                {row.status === "ACTIVE" ? (
                  <ConfirmButton size="sm" variant="ghost" confirmLabel="¿Detener?" loading={stop.isPending && stop.variables === row.id} onConfirm={() => stop.mutate(row.id, { onSuccess: () => void enrollments.refetch() })}>
                    Detener
                  </ConfirmButton>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {stop.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          No pudimos detenerla. Intenta de nuevo.
        </p>
      ) : null}
    </Dialog>
  );
}
