"use client";

import type { SiteMemberResponse } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import {
  addSiteMember,
  getMemberSettings,
  listSiteMembers,
  removeSiteMember,
  restoreSiteMember,
  revokeSiteMember,
  setPageMembersOnly,
} from "../../lib/api/members";
import { ConfirmButton } from "../confirm-button";

const PAGE_SIZE = 20;
const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" });

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

/** Miembros del sitio y qué páginas son solo para ellos (F10.1, ADR-029). */
export function MembersPanel({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      <ProtectedPages organizationId={organizationId} siteId={siteId} />
      <MembersList organizationId={organizationId} siteId={siteId} />
    </div>
  );
}

function ProtectedPages({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const key = ["member-settings", organizationId, siteId];
  const settings = useQuery({ queryKey: key, queryFn: () => getMemberSettings(organizationId, siteId) });
  // Valor que el usuario acaba de elegir y el servidor aún no confirmó. Estado local y síncrono: el interruptor cambia en el
  // mismo instante del clic y vuelve atrás solo si el servidor lo rechaza.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const toggle = useMutation({
    mutationFn: (input: { pageId: string; enabled: boolean }) => setPageMembersOnly(organizationId, siteId, input.pageId, input.enabled),
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onSettled: (_data, _error, input) =>
      setPending((current) => {
        const next = { ...current };
        delete next[input.pageId];
        return next;
      }),
  });
  const choose = (pageId: string, enabled: boolean) => {
    setPending((current) => ({ ...current, [pageId]: enabled }));
    toggle.mutate({ pageId, enabled });
  };

  return (
    <section aria-labelledby="paginas-protegidas" className="flex flex-col gap-3">
      <div>
        <h2 id="paginas-protegidas" className="text-lg font-semibold text-foreground">
          Páginas solo para miembros
        </h2>
        <p className="text-sm text-muted-foreground">
          Su contenido solo se entrega a quien entró con su enlace. El cambio es inmediato, sin volver a publicar. Los buscadores no las ven.
        </p>
      </div>
      {settings.isPending ? (
        <LoadingState label="Cargando páginas…" />
      ) : settings.isError ? (
        <ErrorState onRetry={() => settings.refetch()} />
      ) : settings.data.pages.length === 0 ? (
        <EmptyState title="Este sitio todavía no tiene páginas" />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
          {settings.data.pages.map((page) => (
            <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{page.isHome ? "Inicio" : page.slug}</span>
                <span className="text-xs text-muted-foreground">{page.published ? "Publicada" : "Sin publicar"}</span>
              </div>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={pending[page.id] ?? page.membersOnly}
                  onChange={(event) => choose(page.id, event.target.checked)}
                />
                Solo miembros
                <span className="sr-only"> — {page.isHome ? "Inicio" : page.slug}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {toggle.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorText(toggle.error, "No pudimos cambiar la página. Intenta de nuevo.")}
        </p>
      ) : null}
    </section>
  );
}

function MembersList({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "REVOKED">("");
  const [page, setPage] = useState(1);
  const params = { search: search.trim() || undefined, status: status || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({
    queryKey: ["site-members", organizationId, siteId, params],
    queryFn: () => listSiteMembers(organizationId, siteId, params),
    placeholderData: keepPreviousData,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["site-members", organizationId, siteId] });
    void queryClient.invalidateQueries({ queryKey: ["member-settings", organizationId, siteId] });
  };

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sendAccess, setSendAccess] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => addSiteMember(organizationId, siteId, { email: email.trim(), name: name.trim() || undefined, sendAccess }),
    onSuccess: () => {
      setEmail("");
      setName("");
      refresh();
    },
  });
  const act = useMutation({
    mutationFn: async (input: { kind: "revoke" | "restore" | "remove"; member: SiteMemberResponse }): Promise<void> => {
      if (input.kind === "revoke") await revokeSiteMember(organizationId, siteId, input.member.id);
      else if (input.kind === "restore") await restoreSiteMember(organizationId, siteId, input.member.id);
      else await removeSiteMember(organizationId, siteId, input.member.id);
    },
    onSuccess: refresh,
  });

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setInvalid("Escribe un correo válido.");
      return;
    }
    setInvalid(null);
    add.mutate();
  }

  return (
    <section aria-labelledby="miembros" className="flex flex-col gap-4">
      <div>
        <h2 id="miembros" className="text-lg font-semibold text-foreground">
          Miembros
        </h2>
        <p className="text-sm text-muted-foreground">
          Personas con acceso a las páginas protegidas. Entran con un enlace a su correo, sin contraseña. Cortar a alguien surte efecto en el acto.
        </p>
      </div>

      <form noValidate onSubmit={submit} aria-label="Agregar miembro" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Correo" type="email" value={email} onChange={(event) => setEmail(event.target.value)} error={invalid ?? undefined} required />
          <Input label="Nombre (opcional)" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </div>
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="size-4" checked={sendAccess} onChange={(event) => setSendAccess(event.target.checked)} />
          Enviarle su enlace de acceso por correo ahora
        </label>
        {add.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorText(add.error, "No pudimos agregar al miembro. Intenta de nuevo.")}
          </p>
        ) : null}
        <div>
          <Button type="submit" loading={add.isPending}>
            Agregar miembro
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Input
            label="Buscar"
            type="search"
            value={search}
            placeholder="Correo o nombre"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Estado
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setPage(1);
            }}
            className="min-h-10 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="REVOKED">Revocados</option>
          </select>
        </label>
      </div>

      {list.isPending ? (
        <LoadingState label="Cargando miembros…" />
      ) : list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={search || status ? "Sin resultados" : "Todavía no tienes miembros"}
          description={search || status ? "Prueba con otra búsqueda o filtro." : "Agrega a la primera persona con el formulario de arriba."}
        />
      ) : (
        <div className="flex flex-col gap-3" aria-busy={list.isFetching}>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
            {list.data.items.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{member.name ?? member.email}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {member.name ? `${member.email} · ` : ""}
                    {member.lastAccessAt ? `Último acceso ${dateFormat.format(new Date(member.lastAccessAt))}` : "Aún no ha entrado"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      member.status === "ACTIVE"
                        ? "rounded-sm border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary"
                        : "rounded-sm border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    }
                  >
                    {member.status === "ACTIVE" ? "Activo" : "Revocado"}
                  </span>
                  {member.status === "ACTIVE" ? (
                    <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Cortar su acceso?" onConfirm={() => act.mutate({ kind: "revoke", member })}>
                      Revocar
                    </ConfirmButton>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => act.mutate({ kind: "restore", member })}>
                      Reactivar
                    </Button>
                  )}
                  <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Quitar y borrar sus datos?" onConfirm={() => act.mutate({ kind: "remove", member })}>
                    Quitar
                  </ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
          {act.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorText(act.error, "No pudimos completar la acción. Intenta de nuevo.")}
            </p>
          ) : null}
          {list.data.total > PAGE_SIZE ? (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Página {list.data.page} de {Math.ceil(list.data.total / PAGE_SIZE)} · {list.data.total} miembros
              </span>
              <span className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button variant="secondary" size="sm" disabled={page * PAGE_SIZE >= list.data.total} onClick={() => setPage((p) => p + 1)}>
                  Siguiente
                </Button>
              </span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
