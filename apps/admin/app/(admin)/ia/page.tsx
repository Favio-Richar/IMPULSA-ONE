"use client";

import type { AdminAiConnectionResponse } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { useQuery } from "@tanstack/react-query";
import { Info, Plus } from "lucide-react";
import { useState } from "react";
import { ConnectionFormDialog } from "../../../components/ai/connection-form";
import { ConnectionsList } from "../../../components/ai/connections-list";
import { RoutesEditor } from "../../../components/ai/routes-editor";
import { UsagePanel } from "../../../components/ai/usage-panel";
import { PageHeader, Section } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";

/**
 * Inteligencia artificial (F6.2b, ADR-010): conexiones a proveedores o al servidor de modelos
 * propio, qué conexión usa cada tarea y cuánto se consume. Solo superadministración.
 */
export default function AiPage(): React.JSX.Element {
  const connectionsQuery = useQuery({ queryKey: ["admin", "ai", "connections"], queryFn: adminApi.aiConnections });
  const routesQuery = useQuery({ queryKey: ["admin", "ai", "routes"], queryFn: adminApi.aiRoutes });
  const usageQuery = useQuery({ queryKey: ["admin", "ai", "usage"], queryFn: adminApi.aiUsage });
  // `undefined` = cerrado; `null` = conexión nueva.
  const [editing, setEditing] = useState<AdminAiConnectionResponse | null | undefined>(undefined);
  const [routesSaved, setRoutesSaved] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inteligencia artificial"
        description="Los modelos que usa el asistente de todos los clientes: un servidor propio, proveedores en la nube o ambos, con respaldo automático."
        actions={
          <Button type="button" onClick={() => setEditing(null)}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar conexión
          </Button>
        }
      />
      <p className="flex gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Los tokens se guardan cifrados y no se vuelven a mostrar. Nunca se guarda el texto que se le envía al modelo ni su respuesta: solo tokens,
        costo y resultado. Cada cambio queda en la auditoría.
      </p>

      <Section title="Conexiones" description="Un servidor propio (Ollama, vLLM, LM Studio), OpenAI, Gemini, Groq, OpenRouter o Claude.">
        {connectionsQuery.isPending ? (
          <LoadingState label="Cargando conexiones…" />
        ) : connectionsQuery.isError ? (
          <ErrorState onRetry={() => connectionsQuery.refetch()} />
        ) : connectionsQuery.data.length === 0 ? (
          <EmptyState
            title="Todavía no hay conexiones"
            description="Sin conexiones, el asistente aparece como «no disponible» para los clientes. Agrega tu servidor de modelos o un proveedor."
            action={
              <Button type="button" onClick={() => setEditing(null)}>
                Agregar la primera conexión
              </Button>
            }
          />
        ) : (
          <ConnectionsList connections={connectionsQuery.data} onEdit={setEditing} />
        )}
      </Section>

      <Section title="Rutas por tarea" description="La primera conexión de cada tarea es la principal; si falla, se prueba la siguiente.">
        {routesQuery.isPending || connectionsQuery.isPending ? (
          <LoadingState label="Cargando rutas…" />
        ) : routesQuery.isError || connectionsQuery.isError ? (
          <ErrorState onRetry={() => void Promise.all([routesQuery.refetch(), connectionsQuery.refetch()])} />
        ) : connectionsQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Agrega una conexión para poder armar las rutas.</p>
        ) : (
          // La `key` vuelve a montar el editor cuando las rutas cambian en el servidor (guardar, o borrar
          // una conexión que estaba en una ruta), así nunca edita sobre un estado viejo.
          <RoutesEditor
            key={JSON.stringify(routesQuery.data.routes)}
            connections={connectionsQuery.data}
            initial={routesQuery.data.routes}
            saved={routesSaved}
            onSavedChange={setRoutesSaved}
          />
        )}
      </Section>

      <Section title="Consumo del mes" description="Mes calendario UTC. El costo es estimado con el precio de cada conexión.">
        {usageQuery.isPending ? (
          <LoadingState label="Cargando consumo…" />
        ) : usageQuery.isError ? (
          <ErrorState onRetry={() => usageQuery.refetch()} />
        ) : (
          <UsagePanel usage={usageQuery.data} />
        )}
      </Section>

      {editing !== undefined ? (
        <ConnectionFormDialog
          key={editing?.id ?? "new"}
          open
          connection={editing}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(undefined);
            }
          }}
        />
      ) : null}
    </div>
  );
}
