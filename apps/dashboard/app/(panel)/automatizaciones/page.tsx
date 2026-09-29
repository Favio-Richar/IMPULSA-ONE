"use client";

import type { AutomationListItemResponse } from "@impulza/contracts";
import { Button, Dialog, EmptyState, ErrorState, Input, LoadingState, Select, cn } from "@impulza/ui";
import {
  AUTOMATION_ACTION_LABELS,
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGER_LABELS,
  AUTOMATION_TRIGGERS,
  COMMERCIAL_STATUS_LABELS,
  CONTACT_COMMERCIAL_STATUS_VALUES,
  MAX_AUTOMATIONS_PER_ORGANIZATION,
  createAutomationSchema,
  type AutomationActionType,
  type AutomationTrigger,
  type ContactCommercialStatus,
} from "@impulza/validation";
import { ArrowRight, History, Plus, Workflow } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ConfirmButton } from "../../../components/confirm-button";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { ApiError } from "../../../lib/api-client";
import { RUN_STATUS_LABELS, automationSentence } from "../../../lib/automation-text";
import { useAutomationRuns, useAutomations, useCreateAutomation, useDeleteAutomation, useUpdateAutomation } from "../../../lib/hooks/use-automations";

// Automatizaciones básicas (F6.7): disparador → acción, de un catálogo cerrado. Las ejecuta el
// worker una vez por evento; cada ejecución queda en el registro.

const DATE_TIME = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function AutomatizacionesPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus automatizaciones." />;
  }
  return <Automations organizationId={activeOrganizationId} />;
}

function Automations({ organizationId }: { organizationId: string }): React.JSX.Element {
  const query = useAutomations(organizationId);
  const [creating, setCreating] = useState(false);
  const [historyOf, setHistoryOf] = useState<AutomationListItemResponse | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">Automatizaciones</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Cuando pasa algo en tus sitios, el sistema hace una tarea por ti: etiquetar al contacto, cambiar su estado comercial o avisarle al
            equipo por correo. Cada automatización corre una sola vez por evento y todo queda registrado.
          </p>
        </div>
        <Button type="button" onClick={() => setCreating(true)} disabled={(query.data?.length ?? 0) >= MAX_AUTOMATIONS_PER_ORGANIZATION} className="shrink-0">
          <Plus className="size-4" aria-hidden="true" />
          Nueva automatización
        </Button>
      </div>

      {query.isPending ? (
        <LoadingState label="Cargando automatizaciones…" />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          title="Todavía no hay automatizaciones"
          description="Por ejemplo: cuando llega un contacto nuevo, etiquétalo como «lead-web»; o cuando alguien reserva, avísale al equipo."
          action={
            <Button type="button" size="sm" onClick={() => setCreating(true)}>
              Crear la primera
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Automatizaciones">
          {query.data.map((automation) => (
            <AutomationRow key={automation.id} organizationId={organizationId} automation={automation} onHistory={() => setHistoryOf(automation)} />
          ))}
        </ul>
      )}
      {(query.data?.length ?? 0) >= MAX_AUTOMATIONS_PER_ORGANIZATION ? (
        <p className="text-sm text-muted-foreground">Llegaste al máximo de {MAX_AUTOMATIONS_PER_ORGANIZATION}. Borra una que ya no uses para crear otra.</p>
      ) : null}

      {creating ? <NewAutomationDialog organizationId={organizationId} onClose={() => setCreating(false)} /> : null}
      {historyOf ? <RunsDialog organizationId={organizationId} automation={historyOf} onClose={() => setHistoryOf(null)} /> : null}
    </div>
  );
}

function AutomationRow({ organizationId, automation, onHistory }: { organizationId: string; automation: AutomationListItemResponse; onHistory: () => void }): React.JSX.Element {
  const update = useUpdateAutomation(organizationId);
  const remove = useDeleteAutomation(organizationId);
  const sentence = automationSentence(automation.trigger, automation.action);
  const toggleId = `automation-${automation.id}-enabled`;
  // Optimista: mientras se guarda, el interruptor muestra lo pedido; si falla, vuelve solo al valor real.
  const enabled = update.isPending && update.variables.changes.enabled !== undefined ? update.variables.changes.enabled : automation.enabled;

  return (
    <li className={cn("flex flex-col gap-3 rounded-lg border border-border bg-background p-4 shadow-xs", !enabled && "bg-surface")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-md", enabled ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground")}>
            <Workflow className="size-4" aria-hidden="true" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            {/* Sin nombre propio, el nombre ya es la regla: no se repite abajo. */}
            {automation.name !== sentence.then ? <p className="font-medium text-foreground">{automation.name}</p> : null}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>{sentence.when}</span>
              <ArrowRight className="size-3.5 shrink-0" aria-label="entonces" />
              <span className="font-medium text-foreground">{sentence.then}</span>
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
              if (!update.isPending) {
                update.mutate({ automationId: automation.id, changes: { enabled: event.target.checked } });
              }
            }}
          />
          {/* Interruptor visible; el foco del teclado se ve en el riel (WCAG 2.4.7). */}
          <span
            aria-hidden="true"
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
              "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-focus-ring)] peer-focus-visible:ring-offset-2",
              // Apagado con contraste suficiente para un control (WCAG 1.4.11, ≥ 3:1), no gris claro.
              enabled ? "border-primary bg-primary" : "border-muted-foreground bg-muted-foreground",
            )}
          >
            <span className={cn("inline-block size-4 rounded-full bg-background shadow-xs transition-transform", enabled ? "translate-x-6" : "translate-x-1")} />
          </span>
          <span className="w-20">{enabled ? "Encendida" : "Apagada"}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground tabular-nums">
          Últimos 30 días: {automation.runsLast30Days.succeeded} {automation.runsLast30Days.succeeded === 1 ? "hecha" : "hechas"}
          {automation.runsLast30Days.failed > 0 ? <span className="text-danger"> · {automation.runsLast30Days.failed} con falla</span> : null}
          {automation.lastRun ? ` · última el ${DATE_TIME.format(new Date(automation.lastRun.createdAt))}` : " · todavía no se ejecuta"}
        </p>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onHistory}>
            <History className="size-4" aria-hidden="true" />
            Registro
          </Button>
          <ConfirmButton size="sm" variant="ghost" confirmLabel="¿Borrar?" loading={remove.isPending} onConfirm={() => remove.mutate(automation.id)}>
            Borrar
          </ConfirmButton>
        </div>
      </div>
      {update.isError || remove.isError ? (
        <p role="alert" className="text-sm text-danger">
          {(update.error ?? remove.error) instanceof ApiError && ((update.error ?? remove.error) as ApiError).status === 403
            ? "Tu rol no permite cambiar automatizaciones."
            : "No pudimos guardar el cambio. Intenta de nuevo."}
        </p>
      ) : null}
    </li>
  );
}

function NewAutomationDialog({ organizationId, onClose }: { organizationId: string; onClose: () => void }): React.JSX.Element {
  const create = useCreateAutomation(organizationId);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTrigger>("contact_created");
  const [actionType, setActionType] = useState<AutomationActionType>("tag_contact");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState<ContactCommercialStatus>("CONTACTED");
  const [error, setError] = useState<string | null>(null);

  const action = actionType === "tag_contact" ? { type: actionType, tag: tag.trim() } : actionType === "set_commercial_status" ? { type: actionType, status } : { type: actionType };
  const preview = automationSentence(trigger, action);

  function submit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    // Sin nombre, se usa la acción (siempre cabe en 80: la etiqueta tiene hasta 40); la fila no la repite.
    const parsed = createAutomationSchema.safeParse({ name: name.trim() || preview.then, trigger, action });
    if (!parsed.success) {
      setError(actionType === "tag_contact" ? "Escribe la etiqueta (hasta 40 caracteres)." : "Revisa los campos.");
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: onClose,
      onError: (failure) =>
        setError(
          failure instanceof ApiError && failure.status === 403
            ? "Tu rol no permite crear automatizaciones."
            : failure instanceof ApiError && (failure.body as { code?: unknown } | undefined)?.code === "AUTOMATION_LIMIT_REACHED"
              ? `Llegaste al máximo de ${MAX_AUTOMATIONS_PER_ORGANIZATION} automatizaciones.`
              : "No pudimos crearla. Intenta de nuevo.",
        ),
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Nueva automatización"
      description="Elige qué la dispara y qué hace. Queda encendida al crearla."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="nueva-automatizacion" loading={create.isPending}>
            Crear automatización
          </Button>
        </>
      }
    >
      <form id="nueva-automatizacion" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Select
          label="Cuando"
          options={AUTOMATION_TRIGGERS.map((value) => ({ value, label: AUTOMATION_TRIGGER_LABELS[value] }))}
          value={trigger}
          onChange={(event) => {
            setTrigger(event.target.value as AutomationTrigger);
            setError(null);
          }}
        />
        <Select
          label="Entonces"
          options={AUTOMATION_ACTION_TYPES.map((value) => ({ value, label: AUTOMATION_ACTION_LABELS[value] }))}
          value={actionType}
          onChange={(event) => {
            setActionType(event.target.value as AutomationActionType);
            setError(null);
          }}
        />
        {actionType === "tag_contact" ? (
          <Input label="Etiqueta" placeholder="lead-web" maxLength={40} value={tag}
            onChange={(event) => {
              setTag(event.target.value);
              setError(null);
            }} />
        ) : actionType === "set_commercial_status" ? (
          <Select
            label="Nuevo estado comercial"
            options={CONTACT_COMMERCIAL_STATUS_VALUES.map((value) => ({ value, label: COMMERCIAL_STATUS_LABELS[value] }))}
            value={status}
            onChange={(event) => setStatus(event.target.value as ContactCommercialStatus)}
          />
        ) : (
          <p className="rounded-md border border-border bg-surface p-3 text-sm text-muted-foreground">
            Llega un correo a los dueños y administradores de la organización con los datos del contacto y el detalle de la reserva o el pedido.
          </p>
        )}
        <Input label="Nombre (opcional)" placeholder="Se arma solo si lo dejas vacío" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        <div className="rounded-md border border-primary/25 bg-primary/5 p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Así quedará</p>
          <p className="mt-1 text-foreground">
            {preview.when} → {preview.then}
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function RunsDialog({ organizationId, automation, onClose }: { organizationId: string; automation: AutomationListItemResponse; onClose: () => void }): React.JSX.Element {
  const runs = useAutomationRuns(organizationId, automation.id);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())} title={`Registro · ${automation.name}`} description="Las últimas 50 ejecuciones, de la más reciente a la más antigua." size="lg">
      {runs.isPending ? (
        <LoadingState label="Cargando registro…" />
      ) : runs.isError ? (
        <ErrorState onRetry={() => void runs.refetch()} />
      ) : runs.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no se ha ejecutado. Aparecerá acá la próxima vez que ocurra el evento.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-border" aria-label="Ejecuciones">
          {runs.data.map((run) => (
            <li key={run.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground">{DATE_TIME.format(new Date(run.createdAt))}</span>
                {run.detail ? <span className="text-xs text-muted-foreground">{run.detail}</span> : null}
              </div>
              <span
                className={cn(
                  "w-fit rounded-sm px-2 py-0.5 text-xs font-medium",
                  run.status === "SUCCEEDED" && "bg-success/10 text-success",
                  run.status === "FAILED" && "bg-danger/10 text-danger",
                  (run.status === "SKIPPED" || run.status === "PENDING") && "bg-surface text-muted-foreground",
                )}
              >
                {RUN_STATUS_LABELS[run.status]}
                {run.attempts > 1 ? ` · ${run.attempts} intentos` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
