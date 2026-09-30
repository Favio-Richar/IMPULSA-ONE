"use client";

import type { WebhookDeliveryResponse, WebhookEndpointResponse } from "@impulza/contracts";
import { Button, Dialog, ErrorState, LoadingState, Select, cn } from "@impulza/ui";
import { WEBHOOK_DELIVERY_STATUSES, type ListWebhookDeliveriesQuery } from "@impulza/validation";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useRedeliverWebhook, useWebhookDeliveries, useWebhookDelivery } from "../../lib/hooks/use-webhooks";
import { DELIVERY_STATUS_LABELS, deliveryErrorText, displayUrl, eventLabel } from "../../lib/webhook-text";

const DATE_TIME = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

type StatusFilter = NonNullable<ListWebhookDeliveriesQuery["status"]> | "ALL";

export function DeliveryStatusBadge({ status }: { status: WebhookDeliveryResponse["status"] }): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-sm px-2 py-0.5 text-xs font-medium",
        status === "SUCCEEDED" && "bg-success/10 text-success",
        status === "FAILED" && "bg-danger/10 text-danger",
        status === "PENDING" && "bg-primary/10 text-primary",
        status === "SKIPPED" && "bg-surface text-muted-foreground",
      )}
    >
      {DELIVERY_STATUS_LABELS[status]}
    </span>
  );
}

/** Registro de entregas de un destino (F7.2): las últimas 50 de 30 días, con filtro, detalle y reenvío. */
export function DeliveriesDialog({ organizationId, endpoint, onClose }: { organizationId: string; endpoint: WebhookEndpointResponse; onClose: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const deliveries = useWebhookDeliveries(organizationId, endpoint.id, status === "ALL" ? {} : { status });
  const { host } = displayUrl(endpoint.url);

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Registro · ${endpoint.description ?? host}`}
      description="Las últimas 50 entregas. Se guardan 30 días."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div className="max-w-56">
          <Select
            label="Mostrar"
            value={status}
            options={[{ value: "ALL", label: "Todas" }, ...WEBHOOK_DELIVERY_STATUSES.map((value) => ({ value, label: DELIVERY_STATUS_LABELS[value] }))]}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
          />
        </div>
        {deliveries.isPending ? (
          <LoadingState label="Cargando entregas…" />
        ) : deliveries.isError ? (
          <ErrorState onRetry={() => void deliveries.refetch()} />
        ) : deliveries.data.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {status === "ALL" ? "Todavía no hay entregas. Envía una prueba o espera al próximo evento." : "No hay entregas con ese estado."}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label="Entregas">
            {deliveries.data.map((delivery) => (
              <DeliveryRow key={delivery.id} organizationId={organizationId} endpoint={endpoint} delivery={delivery} />
            ))}
          </ol>
        )}
      </div>
    </Dialog>
  );
}

function DeliveryRow({ organizationId, endpoint, delivery }: { organizationId: string; endpoint: WebhookEndpointResponse; delivery: WebhookDeliveryResponse }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const detail = useWebhookDelivery(organizationId, endpoint.id, open ? delivery.id : null);
  const redeliver = useRedeliverWebhook(organizationId, endpoint.id);
  const reason = deliveryErrorText(delivery);
  const bodyId = `delivery-${delivery.id}-body`;

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{eventLabel(delivery.eventType)}</span>
            <DeliveryStatusBadge status={delivery.status} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {DATE_TIME.format(new Date(delivery.createdAt))}
            {delivery.attempts > 0 ? ` · ${delivery.attempts} ${delivery.attempts === 1 ? "intento" : "intentos"}` : " · en cola"}
            {delivery.lastStatusCode !== null ? ` · HTTP ${delivery.lastStatusCode}` : ""}
            {delivery.lastDurationMs !== null ? ` · ${delivery.lastDurationMs} ms` : ""}
          </p>
          {reason && delivery.status !== "SUCCEEDED" ? <p className="text-xs text-danger">{reason}</p> : null}
          {delivery.status === "PENDING" && delivery.nextAttemptAt && delivery.attempts > 0 ? (
            <p className="text-xs text-muted-foreground">Próximo intento: {DATE_TIME.format(new Date(delivery.nextAttemptAt))}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" variant="ghost" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
            {open ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
            Cuerpo
          </Button>
          {delivery.status !== "PENDING" ? (
            <Button type="button" size="sm" variant="ghost" loading={redeliver.isPending} disabled={!endpoint.active} onClick={() => redeliver.mutate(delivery.id)}>
              {redeliver.isPending ? null : <RotateCcw className="size-4" aria-hidden="true" />}
              Reenviar
            </Button>
          ) : null}
        </div>
      </div>
      {redeliver.isError ? (
        <p role="alert" className="text-xs text-danger">
          {redeliver.error instanceof ApiError && redeliver.error.status === 422 ? "Reanuda el destino para reenviar." : "No pudimos reenviarla. Intenta de nuevo."}
        </p>
      ) : null}
      {open ? (
        <div id={bodyId}>
          {detail.isPending ? (
            <p className="text-xs text-muted-foreground">Cargando…</p>
          ) : detail.isError ? (
            <p role="alert" className="text-xs text-danger">
              No pudimos cargar el cuerpo.
            </p>
          ) : (
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-foreground">
              {JSON.stringify(detail.data.payload, null, 2)}
            </pre>
          )}
        </div>
      ) : null}
    </li>
  );
}
