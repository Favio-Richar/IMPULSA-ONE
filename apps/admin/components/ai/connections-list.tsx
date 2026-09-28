"use client";

import type { AdminAiConnectionResponse, AdminAiConnectionTestResponse } from "@impulza/contracts";
import { Button, Dialog } from "@impulza/ui";
import { AI_TASK_LABELS, formatMicroUsd, type AiTaskCode } from "@impulza/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Pencil, PlugZap, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { adminApi } from "../../lib/api";
import { formatInteger } from "../../lib/format";
import { Tag } from "../ui-bits";

const OUTCOME_TEXT: Record<string, string> = {
  ok: "Respondió bien",
  timeout: "No respondió a tiempo",
  invalid_output: "Respondió, pero no en el formato pedido",
  rate_limited: "El proveedor pidió esperar",
  auth_error: "Rechazó el token",
  refused: "El modelo declinó responder",
  provider_error: "No se pudo conectar o el proveedor dio error",
};

function taskLabel(task: string): string {
  return AI_TASK_LABELS[task as AiTaskCode]?.label ?? task;
}

export function ConnectionsList({
  connections,
  onEdit,
}: {
  connections: AdminAiConnectionResponse[];
  onEdit: (connection: AdminAiConnectionResponse) => void;
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3">
      {connections.map((connection) => (
        <ConnectionRow key={connection.id} connection={connection} onEdit={() => onEdit(connection)} />
      ))}
    </ul>
  );
}

function ConnectionRow({ connection, onEdit }: { connection: AdminAiConnectionResponse; onEdit: () => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const test = useMutation({ mutationFn: () => adminApi.testAiConnection(connection.id) });
  const remove = useMutation({
    mutationFn: () => adminApi.deleteAiConnection(connection.id),
    onSuccess: () => {
      setConfirmDelete(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "ai"] });
    },
  });
  const isFree = connection.inputMicroUsdPerMTok === 0 && connection.outputMicroUsdPerMTok === 0;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4" data-connection={connection.name}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            <span className="break-all">{connection.name}</span>
            <Tag tone={connection.enabled ? "primary" : "neutral"}>{connection.enabled ? "Activa" : "Apagada"}</Tag>
            <Tag>{connection.kind === "ANTHROPIC" ? "Claude" : "Compatible con OpenAI"}</Tag>
          </p>
          <p className="break-all text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{connection.model}</span>
            {connection.baseUrl ? ` · ${connection.baseUrl}` : " · API oficial"}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <KeyRound className="size-3.5" aria-hidden="true" />
              {connection.hasApiKey ? `Token …${connection.apiKeyHint}` : "Sin token"}
            </span>
            <span>{isFree ? "Sin costo por token" : `${formatMicroUsd(connection.inputMicroUsdPerMTok)} / ${formatMicroUsd(connection.outputMicroUsdPerMTok)} por millón (entrada / salida)`}</span>
            <span>Tiempo máximo {formatInteger(connection.timeoutMs / 1000)} s</span>
          </p>
          <p className="flex flex-wrap gap-1.5 pt-1">
            {connection.tasks.length === 0 ? (
              <span className="text-xs text-muted-foreground">No está en ninguna ruta todavía.</span>
            ) : (
              connection.tasks.map((task) => <Tag key={task}>{taskLabel(task)}</Tag>)
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
            <PlugZap className="size-4" aria-hidden="true" />
            Probar
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onEdit} aria-label={`Editar ${connection.name}`}>
            <Pencil className="size-4" aria-hidden="true" />
            Editar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={`Borrar ${connection.name}`}>
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {test.isSuccess ? <TestResult result={test.data} /> : null}
      {test.isError ? (
        <p role="alert" className="text-sm text-danger">
          No se pudo hacer la prueba. Intenta de nuevo.
        </p>
      ) : null}

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`¿Borrar «${connection.name}»?`}
        description="Sale de todas las rutas. Las tareas que se queden sin conexiones dejarán de estar disponibles. El historial de uso se conserva."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
              Borrar conexión
            </Button>
          </>
        }
      >
        {remove.isError ? (
          <p role="alert" className="text-sm text-danger">
            No se pudo borrar. Intenta de nuevo.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Esta acción queda en la auditoría.</p>
        )}
      </Dialog>
    </li>
  );
}

function TestResult({ result }: { result: AdminAiConnectionTestResponse }): React.JSX.Element {
  const Icon = result.ok ? CheckCircle2 : XCircle;
  return (
    <p
      role="status"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border p-2 text-sm text-foreground ${result.ok ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5"}`}
    >
      <Icon className={`size-4 shrink-0 ${result.ok ? "text-success" : "text-danger"}`} aria-hidden="true" />
      <span className="font-medium">{OUTCOME_TEXT[result.outcome] ?? result.outcome}</span>
      <span className="text-muted-foreground">
        en {formatInteger(result.durationMs)} ms
        {result.model ? ` · modelo ${result.model}` : ""}
        {result.ok ? ` · ${formatInteger(result.inputTokens + result.outputTokens)} tokens` : ""}
      </span>
    </p>
  );
}
