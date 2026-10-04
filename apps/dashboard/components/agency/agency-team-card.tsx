"use client";

import { AGENCY_MODULES, scopeWithin, type AgencyModuleKey, type AgencyScope } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import type { AgencyMemberScopeResponse, AgencyTeamMemberResponse, AgencyTeamResponse } from "@impulza/contracts";
import { useState } from "react";
import { useAgencyTeam, useSetMemberScope } from "../../lib/hooks/use-agency";
import { roleLabel, serverMessage } from "../team/team-text";

const MODULE_LABEL = new Map<string, string>(AGENCY_MODULES.map((module) => [module.key, module.label]));

const asScope = (scope: AgencyMemberScopeResponse): AgencyScope => ({ allClients: scope.allClients, clientIds: scope.clientIds, modules: scope.modules as AgencyModuleKey[] });

function summary(scope: AgencyMemberScopeResponse, clients: AgencyTeamResponse["clients"]): string {
  const where = scope.allClients ? "Todos los clientes" : `${scope.clientIds.length === 1 ? "1 cliente" : `${scope.clientIds.length} clientes`}: ${scope.clientIds.map((id) => clients.find((client) => client.id === id)?.name ?? "—").join(", ")}`;
  const what = scope.modules.length === 0 ? "todos los módulos" : scope.modules.map((module) => MODULE_LABEL.get(module) ?? module).join(", ");
  return `${where} · ${what}`;
}

/**
 * Equipo de la agencia: hasta dónde llega cada persona (por cliente y por módulo, F9.6b). El editor solo ofrece lo que quien lo usa puede dar
 * y no deja cambiar el propio acceso ni el del propietario; el servidor lo vuelve a comprobar y la puerta de entrada lo aplica en cada petición.
 */
export function AgencyTeamCard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const team = useAgencyTeam(organizationId);
  const [editing, setEditing] = useState<string | null>(null);

  if (team.isPending) return <LoadingState label="Cargando el equipo de la agencia…" />;
  if (team.isError) return <ErrorState onRetry={() => void team.refetch()} />;

  const { members, clients, actorScope } = team.data;
  return (
    <Card data-testid="agency-team-card">
      <CardHeader>
        <CardTitle>Equipo y acceso a clientes</CardTitle>
        <CardDescription>
          Las personas de tu agencia que entran a los negocios de tus clientes. Puedes limitar a cada una a ciertos clientes y a ciertas secciones; el propietario siempre ve todo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <EmptyState title="Sin equipo todavía" description="Invita a alguien como administrador o gestor de agencia desde Equipo." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {members.map((member) => (
              <li key={member.userId} className="flex flex-col gap-3 py-3" data-testid="agency-team-member" data-member-email={member.email}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {member.email}
                      {member.isSelf ? " (tú)" : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">{roleLabel(member.role)}</span>
                    <span className="text-xs text-foreground" data-testid="agency-member-scope">
                      {summary(member.scope, clients)}
                    </span>
                  </div>
                  {member.role === "OWNER" || member.isSelf ? (
                    <span className="text-xs text-muted-foreground">{member.role === "OWNER" ? "No se acota" : "No puedes cambiar tu propio acceso"}</span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(editing === member.userId ? null : member.userId)} aria-expanded={editing === member.userId}>
                      {editing === member.userId ? "Cerrar" : "Editar acceso"}
                    </Button>
                  )}
                </div>
                {editing === member.userId ? (
                  <ScopeEditor organizationId={organizationId} member={member} clients={clients} actorScope={actorScope} onDone={() => setEditing(null)} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ScopeEditor({
  organizationId,
  member,
  clients,
  actorScope,
  onDone,
}: {
  organizationId: string;
  member: AgencyTeamMemberResponse;
  clients: AgencyTeamResponse["clients"];
  actorScope: AgencyMemberScopeResponse;
  onDone: () => void;
}): React.JSX.Element {
  const save = useSetMemberScope(organizationId);
  const [allClients, setAllClients] = useState(member.scope.allClients);
  const [clientIds, setClientIds] = useState<Set<string>>(new Set(member.scope.clientIds));
  const [allModules, setAllModules] = useState(member.scope.modules.length === 0);
  const [modules, setModules] = useState<Set<string>>(new Set(member.scope.modules));
  const [error, setError] = useState<string | null>(null);

  const actor = asScope(actorScope);
  const canGiveAllClients = actor.allClients;
  const canGiveAllModules = actor.modules.length === 0;
  const clientAllowed = (id: string) => actor.allClients || actor.clientIds.includes(id);
  const moduleAllowed = (key: string) => canGiveAllModules || actor.modules.includes(key as AgencyModuleKey);

  function toggle(set: Set<string>, setter: (next: Set<string>) => void, value: string, on: boolean): void {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    setter(next);
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const body = { allClients, clientIds: allClients ? [] : [...clientIds], modules: (allModules ? [] : [...modules]) as AgencyModuleKey[] };
    if (!allClients && body.clientIds.length === 0) return setError("Elige al menos un cliente, o marca «todos los clientes».");
    if (!allModules && body.modules.length === 0) return setError("Elige al menos un módulo, o marca «todos los módulos».");
    // El servidor también lo comprueba; esto solo evita un viaje inútil.
    if (!scopeWithin(actor, { allClients: body.allClients, clientIds: body.clientIds, modules: body.modules })) return setError("No puedes dar más acceso del que tú tienes.");
    setError(null);
    save.mutate({ userId: member.userId, body }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-md border border-border bg-surface p-3" data-testid="scope-editor" noValidate>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-foreground">Clientes</legend>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={allClients} disabled={!canGiveAllClients && !allClients} onChange={(event) => setAllClients(event.target.checked)} />
          Todos los clientes, también los que se agreguen después
        </label>
        {allClients ? null : clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no tienes clientes entre los que elegir.</p>
        ) : (
          <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2" data-testid="scope-clients">
            {clients.map((client) => (
              <label key={client.id} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-primary)]"
                  checked={clientIds.has(client.id)}
                  disabled={!clientAllowed(client.id)}
                  onChange={(event) => toggle(clientIds, setClientIds, client.id, event.target.checked)}
                />
                <span className="truncate">{client.name}</span>
                {clientAllowed(client.id) ? null : <span className="text-xs text-muted-foreground">(tú no lo tienes)</span>}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-foreground">Secciones</legend>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={allModules} disabled={!canGiveAllModules && !allModules} onChange={(event) => setAllModules(event.target.checked)} />
          Todas las secciones
        </label>
        {allModules ? null : (
          <div className="grid gap-1 sm:grid-cols-2" data-testid="scope-modules">
            {AGENCY_MODULES.map((module) => (
              <label key={module.key} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-primary)]"
                  checked={modules.has(module.key)}
                  disabled={!moduleAllowed(module.key)}
                  onChange={(event) => toggle(modules, setModules, module.key, event.target.checked)}
                />
                <span>{module.label}</span>
                {moduleAllowed(module.key) ? null : <span className="text-xs text-muted-foreground">(tú no la tienes)</span>}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {error || save.isError ? (
        <p role="alert" className="text-sm text-danger" data-testid="scope-error">
          {error ?? serverMessage(save.error, "No pudimos guardar el acceso.")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={save.isPending}>
          Guardar acceso
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
