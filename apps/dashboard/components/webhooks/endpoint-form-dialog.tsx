"use client";

import type { WebhookEndpointResponse, WebhookSecretResponse } from "@impulza/contracts";
import { Button, Dialog, Input, cn } from "@impulza/ui";
import { MAX_WEBHOOK_ENDPOINTS, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_TYPES, createWebhookEndpointSchema, type WebhookEventType } from "@impulza/validation";
import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api-client";
import { useCreateWebhookEndpoint, useUpdateWebhookEndpoint } from "../../lib/hooks/use-webhooks";

type FieldErrors = { url?: string; description?: string; events?: string; form?: string };

function serverError(failure: unknown): FieldErrors {
  if (!(failure instanceof ApiError)) return { form: "No pudimos guardar. Revisa tu conexión e intenta de nuevo." };
  const body = failure.body as { code?: unknown; issues?: Array<{ path: string; message: string }> } | undefined;
  if (failure.status === 403) return { form: "Solo el dueño o un administrador pueden configurar integraciones." };
  if (body?.code === "WEBHOOK_URL_TAKEN") return { url: "Ya tienes un destino con esa URL." };
  if (body?.code === "WEBHOOK_LIMIT_REACHED") return { form: `Llegaste al máximo de ${MAX_WEBHOOK_ENDPOINTS} destinos.` };
  if (failure.status === 400 && body?.issues) {
    const errors: FieldErrors = {};
    for (const issue of body.issues) {
      const field = issue.path.split(".")[0] as keyof FieldErrors;
      if (field === "url" || field === "description" || field === "events") errors[field] ??= issue.message;
    }
    if (Object.keys(errors).length > 0) return errors;
  }
  return { form: "No pudimos guardar. Intenta de nuevo." };
}

/** Alta o edición de un destino. Al crear, entrega el secreto (una vez) a quien abrió el diálogo. */
export function EndpointFormDialog({
  organizationId,
  endpoint,
  onClose,
  onCreated,
}: {
  organizationId: string;
  endpoint: WebhookEndpointResponse | null;
  onClose: () => void;
  onCreated: (result: WebhookSecretResponse) => void;
}): React.JSX.Element {
  const create = useCreateWebhookEndpoint(organizationId);
  const update = useUpdateWebhookEndpoint(organizationId);
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [events, setEvents] = useState<WebhookEventType[]>((endpoint?.events as WebhookEventType[] | undefined) ?? ["contact.created"]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const pending = create.isPending || update.isPending;

  function toggle(event: WebhookEventType, checked: boolean): void {
    setEvents((current) => (checked ? [...current, event] : current.filter((value) => value !== event)));
    setErrors((current) => ({ ...current, events: undefined, form: undefined }));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    const parsed = createWebhookEndpointSchema.safeParse({ url: url.trim(), description: description.trim() || undefined, events });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as keyof FieldErrors;
        if (field === "url" || field === "description" || field === "events") next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    if (endpoint) {
      update.mutate(
        { endpointId: endpoint.id, changes: { url: parsed.data.url, description: parsed.data.description ?? null, events: parsed.data.events } },
        { onSuccess: onClose, onError: (failure) => setErrors(serverError(failure)) },
      );
    } else {
      create.mutate(parsed.data, { onSuccess: onCreated, onError: (failure) => setErrors(serverError(failure)) });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={endpoint ? "Editar destino" : "Nuevo destino"}
      description="Pega la URL que te da Zapier, Make o tu sistema. Solo se aceptan direcciones https públicas."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="webhook-endpoint-form" loading={pending}>
            {endpoint ? "Guardar cambios" : "Crear destino"}
          </Button>
        </>
      }
    >
      <form id="webhook-endpoint-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input
          label="URL del destino"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://hooks.zapier.com/hooks/catch/…"
          value={url}
          error={errors.url}
          required
          onChange={(event) => {
            setUrl(event.target.value);
            setErrors((current) => ({ ...current, url: undefined, form: undefined }));
          }}
        />
        <Input
          label="Descripción (opcional)"
          placeholder="Planilla de pedidos en Zapier"
          maxLength={120}
          value={description}
          error={errors.description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <fieldset className="flex flex-col gap-2" aria-describedby={errors.events ? "webhook-events-error" : undefined}>
          <legend className="mb-1 text-sm font-medium text-foreground">Eventos que se envían</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {WEBHOOK_EVENT_TYPES.map((type) => {
              const checked = events.includes(type);
              const id = `webhook-event-${type.replace(".", "-")}`;
              return (
                <label
                  key={type}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)] has-[:focus-visible]:ring-offset-2",
                    checked ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-surface",
                  )}
                >
                  <input id={id} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]" checked={checked} onChange={(event) => toggle(type, event.target.checked)} />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">{WEBHOOK_EVENT_LABELS[type].label}</span>
                    <span className="text-xs text-muted-foreground">{WEBHOOK_EVENT_LABELS[type].description}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.events ? (
            <p id="webhook-events-error" role="alert" className="text-sm text-danger">
              {errors.events}
            </p>
          ) : null}
        </fieldset>
        {errors.form ? (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
