"use client";

import type { WebhookEndpointResponse, WebhookSecretResponse } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { MAX_WEBHOOK_ENDPOINTS } from "@impulza/validation";
import { Lock, Plus } from "lucide-react";
import { useState } from "react";
import { DeliveriesDialog } from "../../../components/webhooks/deliveries-dialog";
import { EndpointCard } from "../../../components/webhooks/endpoint-card";
import { EndpointFormDialog } from "../../../components/webhooks/endpoint-form-dialog";
import { IntegrationGuide } from "../../../components/webhooks/integration-guide";
import { SecretDialog } from "../../../components/webhooks/secret-dialog";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { ApiError } from "../../../lib/api-client";
import { useWebhookEndpoints } from "../../../lib/hooks/use-webhooks";

// Integraciones (F7.2, ADR-017): webhooks salientes firmados hacia Zapier, Make o el sistema del
// negocio. Solo OWNER y ADMIN (`webhooks.manage`): la URL puede llevar un token y las entregas llevan
// datos de clientes.

export default function IntegracionesPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus integraciones." />;
  }
  return <Integrations organizationId={activeOrganizationId} />;
}

type Editing = { mode: "create" } | { mode: "edit"; endpoint: WebhookEndpointResponse } | null;

function Integrations({ organizationId }: { organizationId: string }): React.JSX.Element {
  const query = useWebhookEndpoints(organizationId);
  const [editing, setEditing] = useState<Editing>(null);
  const [historyOf, setHistoryOf] = useState<WebhookEndpointResponse | null>(null);
  const [secret, setSecret] = useState<{ value: string; rotated: boolean } | null>(null);
  const forbidden = query.isError && query.error instanceof ApiError && query.error.status === 403;
  const full = (query.data?.length ?? 0) >= MAX_WEBHOOK_ENDPOINTS;

  function showSecret(result: WebhookSecretResponse, rotated: boolean): void {
    setEditing(null);
    setSecret({ value: result.secret, rotated });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">Integraciones</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Envía tus contactos, reservas y pedidos a otras herramientas apenas ocurren: una planilla, tu CRM o cualquier flujo en Zapier o Make. Cada
            aviso va firmado para que tu sistema compruebe que viene de Impulza.
          </p>
        </div>
        {!forbidden ? (
          <Button type="button" onClick={() => setEditing({ mode: "create" })} disabled={query.isPending || full} className="shrink-0">
            <Plus className="size-4" aria-hidden="true" />
            Nuevo destino
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <LoadingState label="Cargando integraciones…" />
      ) : forbidden ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center">
          <Lock className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium text-foreground">Solo el dueño o un administrador ven las integraciones</p>
          <p className="max-w-md text-sm text-muted-foreground">Los destinos pueden llevar claves de otras herramientas y los avisos llevan datos de clientes. Pídele acceso al dueño de la organización.</p>
        </div>
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:items-start">
          <section aria-labelledby="destinos" className="flex flex-col gap-3">
            <h2 id="destinos" className="text-base font-semibold text-foreground">
              Destinos de webhooks <span className="text-sm font-normal text-muted-foreground tabular-nums">({query.data.length} de {MAX_WEBHOOK_ENDPOINTS})</span>
            </h2>
            {query.data.length === 0 ? (
              <EmptyState
                title="Todavía no hay destinos"
                description="Crea uno con la URL que te da Zapier, Make o tu sistema, y elige qué eventos enviar."
                action={
                  <Button type="button" size="sm" onClick={() => setEditing({ mode: "create" })}>
                    Crear el primero
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-3" aria-label="Destinos">
                {query.data.map((endpoint) => (
                  <EndpointCard
                    key={endpoint.id}
                    organizationId={organizationId}
                    endpoint={endpoint}
                    onEdit={() => setEditing({ mode: "edit", endpoint })}
                    onHistory={() => setHistoryOf(endpoint)}
                    onSecret={(result) => showSecret(result, true)}
                  />
                ))}
              </ul>
            )}
            {full ? <p className="text-sm text-muted-foreground">Llegaste al máximo de {MAX_WEBHOOK_ENDPOINTS} destinos. Borra uno que ya no uses para crear otro.</p> : null}
          </section>
          <IntegrationGuide />
        </div>
      )}

      {editing ? (
        <EndpointFormDialog
          organizationId={organizationId}
          endpoint={editing.mode === "edit" ? editing.endpoint : null}
          onClose={() => setEditing(null)}
          onCreated={(result) => showSecret(result, false)}
        />
      ) : null}
      {historyOf ? <DeliveriesDialog organizationId={organizationId} endpoint={historyOf} onClose={() => setHistoryOf(null)} /> : null}
      {secret ? <SecretDialog secret={secret.value} rotated={secret.rotated} onClose={() => setSecret(null)} /> : null}
    </div>
  );
}
