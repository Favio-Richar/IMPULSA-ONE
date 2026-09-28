"use client";

import type { AdminAiConnectionResponse } from "@impulza/contracts";
import { Button, Select } from "@impulza/ui";
import { AI_TASK_CODES, AI_TASK_LABELS, MAX_AI_ROUTE_LENGTH, type AiTaskCode } from "@impulza/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCircle2, X } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { adminApi } from "../../lib/api";

type Routes = Record<AiTaskCode, string[]>;

/**
 * Rutas por tarea (F6.2b): qué conexiones usa cada tarea y en qué orden. La primera es la principal;
 * las siguientes entran si la anterior falla. Se guardan todas juntas (una sola transacción).
 */
export function RoutesEditor({
  connections,
  initial,
  saved,
  onSavedChange,
}: {
  connections: AdminAiConnectionResponse[];
  initial: Record<string, string[]>;
  /** El aviso de guardado vive en la página: guardar recarga las rutas y el editor se vuelve a montar. */
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [routes, setRoutes] = useState<Routes>(
    () => Object.fromEntries(AI_TASK_CODES.map((task) => [task, initial[task] ?? []])) as Routes,
  );
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const dirty = AI_TASK_CODES.some((task) => (initial[task] ?? []).join() !== routes[task].join());

  const mutation = useMutation({
    mutationFn: () => adminApi.setAiRoutes({ routes }),
    onSuccess: () => {
      onSavedChange(true);
      void queryClient.invalidateQueries({ queryKey: ["admin", "ai"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });

  function update(task: AiTaskCode, next: string[]): void {
    onSavedChange(false);
    setRoutes((current) => ({ ...current, [task]: next }));
  }

  function move(task: AiTaskCode, index: number, delta: -1 | 1): void {
    const next = [...routes[task]];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    update(task, next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {AI_TASK_CODES.map((task) => {
          const ids = routes[task];
          const available = connections.filter((connection) => !ids.includes(connection.id));
          return (
            <fieldset key={task} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-foreground">{AI_TASK_LABELS[task].label}</legend>
              <p className="text-xs text-muted-foreground">{AI_TASK_LABELS[task].hint}</p>
              {ids.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-2 text-sm text-muted-foreground">Sin conexiones: esta función no está disponible para los clientes.</p>
              ) : (
                <ol className="flex flex-col gap-2" aria-label={`Orden de ${AI_TASK_LABELS[task].label}`}>
                  {ids.map((id, index) => {
                    const connection = byId.get(id);
                    return (
                      <li key={id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                        <span className="w-20 shrink-0 text-xs text-muted-foreground">{index === 0 ? "Principal" : `Respaldo ${index}`}</span>
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {connection?.name ?? "Conexión borrada"}
                          {connection && !connection.enabled ? <span className="text-muted-foreground"> (apagada)</span> : null}
                        </span>
                        <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => move(task, index, -1)} aria-label={`Subir ${connection?.name ?? ""}`}>
                          <ArrowUp className="size-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={index === ids.length - 1} onClick={() => move(task, index, 1)} aria-label={`Bajar ${connection?.name ?? ""}`}>
                          <ArrowDown className="size-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => update(task, ids.filter((other) => other !== id))} aria-label={`Quitar ${connection?.name ?? ""}`}>
                          <X className="size-4" aria-hidden="true" />
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {available.length > 0 && ids.length < MAX_AI_ROUTE_LENGTH ? (
                <Select
                  label={`Agregar a ${AI_TASK_LABELS[task].label}`}
                  placeholder="— Elige una conexión —"
                  options={available.map((connection) => ({ value: connection.id, label: connection.name }))}
                  value=""
                  onChange={(event) => {
                    if (event.target.value) {
                      update(task, [...ids, event.target.value]);
                    }
                  }}
                />
              ) : null}
            </fieldset>
          );
        })}
      </div>

      {mutation.isError ? (
        <p role="alert" className="text-sm text-danger">
          {mutation.error instanceof ApiError ? mutation.error.messageOr("No se pudieron guardar las rutas.") : "No se pudieron guardar las rutas."}
        </p>
      ) : null}
      {saved && !dirty ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Rutas guardadas. Rigen desde la próxima solicitud.
        </p>
      ) : null}
      <Button type="button" className="w-full sm:w-auto sm:self-start" disabled={!dirty} loading={mutation.isPending} onClick={() => mutation.mutate()}>
        Guardar rutas
      </Button>
    </div>
  );
}
