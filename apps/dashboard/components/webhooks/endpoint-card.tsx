"use client";

import type { WebhookEndpointResponse, WebhookSecretResponse } from "@impulza/contracts";
import { Button, Select, cn } from "@impulza/ui";
import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_TYPES, type WebhookEventType } from "@impulza/validation";
import { History, KeyRound, Pencil, Send, Webhook } from "lucide-react";
import { useState } from "react";
import { ConfirmButton } from "../confirm-button";
import { ApiError } from "../../lib/api-client";
import { useDeleteWebhookEndpoint, useRotateWebhookSecret, useSendWebhookTest, useUpdateWebhookEndpoint } from "../../lib/hooks/use-webhooks";
import { displayUrl, endpointHealth, eventLabel } from "../../lib/webhook-text";

const DATE_TIME = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const TONE_CLASSES = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  muted: "bg-surface text-muted-foreground",
} as const;

type TestEvent = "ping" | WebhookEventType;

export function EndpointCard({
  organizationId,
  endpoint,
  onEdit,
  onHistory,
  onSecret,
}: {
  organizationId: string;
  endpoint: WebhookEndpointResponse;
  onEdit: () => void;
  onHistory: () => void;
  onSecret: (result: WebhookSecretResponse) => void;
}): React.JSX.Element {
  const update = useUpdateWebhookEndpoint(organizationId);
  const remove = useDeleteWebhookEndpoint(organizationId);
  const rotate = useRotateWebhookSecret(organizationId);
  const test = useSendWebhookTest(organizationId);
  const [testEvent, setTestEvent] = useState<TestEvent>("ping");
  // Cambia tras cada rotación: la confirmación vuelve a su estado inicial (no queda armada).
  const [rotations, setRotations] = useState(0);
  // Optimista: mientras se guarda, el interruptor muestra lo pedido; si falla, vuelve solo al valor real.
  const active = update.isPending && update.variables.changes.active !== undefined ? update.variables.changes.active : endpoint.active;
  const health = endpointHealth({ ...endpoint, active });
  const { host, path } = displayUrl(endpoint.url);
  const toggleId = `webhook-${endpoint.id}-active`;
  const testId = `webhook-${endpoint.id}-test-event`;
  const failure = update.error ?? remove.error ?? rotate.error;

  return (
    <li className={cn("flex flex-col gap-4 rounded-lg border border-border bg-background p-4 shadow-xs", !active && "bg-surface")} aria-label={endpoint.description ?? host}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-md", active ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground")}>
            <Webhook className="size-4" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">{endpoint.description ?? host}</p>
              <span className={cn("rounded-sm px-2 py-0.5 text-xs font-medium", TONE_CLASSES[health.tone])}>{health.label}</span>
            </div>
            <p className="min-w-0 break-all font-mono text-xs text-muted-foreground" title={endpoint.url}>
              <span className="text-foreground">{host}</span>
              {path}
            </p>
          </div>
        </div>
        <label htmlFor={toggleId} className="flex shrink-0 cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            id={toggleId}
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={active}
            aria-busy={update.isPending || undefined}
            onChange={(event) => {
              if (!update.isPending) update.mutate({ endpointId: endpoint.id, changes: { active: event.target.checked } });
            }}
          />
          <span
            aria-hidden="true"
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-focus-ring)] peer-focus-visible:ring-offset-2",
              active ? "border-primary bg-primary" : "border-muted-foreground bg-muted-foreground",
            )}
          >
            <span className={cn("inline-block size-4 rounded-full bg-background shadow-xs transition-transform", active ? "translate-x-6" : "translate-x-1")} />
          </span>
          <span className="w-16">{active ? "Activo" : "Pausado"}</span>
        </label>
      </div>

      {health.detail ? <p className={cn("rounded-md px-3 py-2 text-sm", health.tone === "danger" ? "bg-danger/5 text-danger" : "bg-warning/5 text-foreground")}>{health.detail}</p> : null}

      <ul className="flex flex-wrap gap-1.5" aria-label="Eventos">
        {endpoint.events.map((event) => (
          <li key={event} className="rounded-sm border border-border bg-surface px-2 py-0.5 text-xs text-foreground">
            {eventLabel(event)}
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Entregadas (7 días)</dt>
          <dd className="text-sm font-medium tabular-nums text-foreground">{endpoint.deliveriesLast7Days.succeeded}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Fallidas (7 días)</dt>
          <dd className={cn("text-sm font-medium tabular-nums", endpoint.deliveriesLast7Days.failed > 0 ? "text-danger" : "text-foreground")}>{endpoint.deliveriesLast7Days.failed}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Última entrega</dt>
          <dd className="text-sm text-foreground">{endpoint.lastSuccessAt ? DATE_TIME.format(new Date(endpoint.lastSuccessAt)) : "Todavía ninguna"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Secreto</dt>
          <dd className="font-mono text-sm text-foreground">whsec_…{endpoint.secretHint}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="sm:w-56">
            <Select
              id={testId}
              label="Enviar un ejemplo de"
              value={testEvent}
              options={[{ value: "ping", label: "Prueba (ping)" }, ...WEBHOOK_EVENT_TYPES.map((value) => ({ value, label: WEBHOOK_EVENT_LABELS[value].label }))]}
              onChange={(event) => {
                setTestEvent(event.target.value as TestEvent);
                test.reset();
              }}
            />
          </div>
          <Button type="button" variant="secondary" size="md" loading={test.isPending} disabled={!active} onClick={() => test.mutate({ endpointId: endpoint.id, body: { eventType: testEvent } })}>
            {test.isPending ? null : <Send className="size-4" aria-hidden="true" />}
            Enviar
          </Button>
        </div>
        <div className="-ml-3 flex flex-wrap items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onHistory}>
            <History className="size-4" aria-hidden="true" />
            Registro
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            Editar
          </Button>
          <ConfirmButton
            key={rotations}
            size="sm"
            variant="ghost"
            confirmLabel="¿Rotar? El actual deja de valer."
            loading={rotate.isPending}
            onConfirm={() =>
              rotate.mutate(endpoint.id, {
                onSuccess: (result) => {
                  setRotations((count) => count + 1);
                  onSecret(result);
                },
              })
            }
          >
            <KeyRound className="size-4" aria-hidden="true" />
            Rotar secreto
          </ConfirmButton>
          <ConfirmButton size="sm" variant="ghost" confirmLabel="¿Borrar con su registro?" loading={remove.isPending} onConfirm={() => remove.mutate(endpoint.id)}>
            Borrar
          </ConfirmButton>
        </div>
      </div>

      <div aria-live="polite">
        {test.isSuccess ? (
          <p className="text-sm text-success">
            Enviamos {testEvent === "ping" ? "la prueba" : `el ejemplo de «${WEBHOOK_EVENT_LABELS[testEvent].label}»`}. Mira el resultado en el registro.
          </p>
        ) : test.isError ? (
          <p role="alert" className="text-sm text-danger">
            {test.error instanceof ApiError && test.error.status === 429 ? "Enviaste muchas pruebas seguidas. Espera un minuto." : "No pudimos enviar la prueba. Intenta de nuevo."}
          </p>
        ) : null}
        {failure ? (
          <p role="alert" className="text-sm text-danger">
            {failure instanceof ApiError && failure.status === 403 ? "Tu rol no permite cambiar integraciones." : "No pudimos guardar el cambio. Intenta de nuevo."}
          </p>
        ) : null}
      </div>
    </li>
  );
}
