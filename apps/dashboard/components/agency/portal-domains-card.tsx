"use client";

import type { AgencyPortalDomainResponse } from "@impulza/contracts";
import { DOMAIN_CHECK_ERROR_MESSAGES } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useState } from "react";
import { ApiError, apiFetch } from "../../lib/api-client";
import { ConfirmButton } from "../confirm-button";

// Dominio del portal de la agencia (F9.7d, ADR-028 §5). Mismo flujo que el dominio propio de un sitio: el TXT demuestra que el dominio es
// tuyo, y mientras no esté verificado, el portal no se sirve en él. El servidor valida, verifica y decide.

const key = (organizationId: string) => ["agency-portal-domains", organizationId] as const;
const base = (organizationId: string) => `/organizations/${organizationId}/agency/portal-domains`;

function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Muchos intentos seguidos. Espera unos minutos y vuelve a intentarlo.";
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> } | undefined;
    if (Array.isArray(body?.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body?.message === "string") return body.message;
  }
  return fallback;
}

const STATUS: Record<AgencyPortalDomainResponse["status"], { label: string; icon: React.ReactNode }> = {
  PENDING: { label: "Pendiente de verificar", icon: <Clock className="size-4 text-warning" aria-hidden="true" /> },
  FAILED: { label: "Sin verificar", icon: <XCircle className="size-4 text-danger" aria-hidden="true" /> },
  VERIFIED: { label: "Verificado", icon: <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> },
};

export function PortalDomainsCard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState("");
  const list = useQuery({ queryKey: key(organizationId), queryFn: () => apiFetch<AgencyPortalDomainResponse[]>(base(organizationId)) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key(organizationId) });
  const add = useMutation({
    mutationFn: (value: string) => apiFetch<AgencyPortalDomainResponse>(base(organizationId), { method: "POST", body: { domain: value } }),
    onSuccess: async () => {
      setDomain("");
      await refresh();
    },
  });
  const verify = useMutation({
    mutationFn: (id: string) => apiFetch<AgencyPortalDomainResponse>(`${base(organizationId)}/${id}/verify`, { method: "POST" }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`${base(organizationId)}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <Card data-testid="portal-domains">
      <CardHeader>
        <CardTitle>Dominio del portal</CardTitle>
        <CardDescription>
          El portal donde tus clientes revisan y aprueban se verá en tu propio dominio (por ejemplo, portal.tu-agencia.cl). Primero
          demuestras que el dominio es tuyo con un registro TXT; mientras no esté verificado, no se sirve nada en él.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
          aria-label="Agregar dominio del portal"
          onSubmit={(event) => {
            event.preventDefault();
            if (domain.trim() !== "") add.mutate(domain.trim());
          }}
        >
          <Input
            label="Dominio"
            placeholder="portal.tu-agencia.cl"
            autoComplete="off"
            spellCheck={false}
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            error={add.isError ? serverMessage(add.error, "Revisa el dominio: el servidor lo rechazó.") : undefined}
            helperText="Sin https:// ni rutas."
          />
          <Button type="submit" loading={add.isPending} className="sm:mt-6">
            Agregar dominio
          </Button>
        </form>

        {list.isPending ? (
          <LoadingState label="Cargando dominios…" />
        ) : list.isError ? (
          list.error instanceof ApiError && list.error.status === 403 ? (
            <EmptyState title="No disponible" description="Esta organización no es una agencia o no tienes permiso para gestionar su portal." />
          ) : (
            <ErrorState onRetry={() => void list.refetch()} />
          )
        ) : list.data.length === 0 ? (
          <EmptyState title="Sin dominio de portal todavía" description="Agrega uno para que el portal de tus clientes lleve tu dirección." />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Dominios del portal">
            {list.data.map((item) => {
              const status = STATUS[item.status];
              return (
                <li key={item.id} className="flex flex-col gap-3 rounded-lg border border-border p-4" data-domain={item.domain}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-all font-medium text-foreground">{item.domain}</p>
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        {status.icon}
                        <span>{status.label}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.status !== "VERIFIED" ? (
                        <Button variant="secondary" size="sm" loading={verify.isPending && verify.variables === item.id} onClick={() => verify.mutate(item.id)}>
                          Verificar ahora
                        </Button>
                      ) : null}
                      <ConfirmButton
                        variant="ghost"
                        size="sm"
                        confirmLabel="¿Quitar el dominio?"
                        loading={remove.isPending && remove.variables === item.id}
                        onConfirm={() => remove.mutate(item.id)}
                      >
                        Quitar
                      </ConfirmButton>
                    </div>
                  </div>
                  {item.lastCheckError ? <p className="text-sm text-danger">{DOMAIN_CHECK_ERROR_MESSAGES[item.lastCheckError]}</p> : null}
                  {item.status === "VERIFIED" ? (
                    <p className="text-sm text-foreground">
                      Listo: el dominio es tuyo.{" "}
                      {item.cnameTarget
                        ? `Apúntalo con un registro CNAME a ${item.cnameTarget}.`
                        : "El destino del CNAME se define cuando la plataforma esté publicada en su dominio definitivo."}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1 text-sm">
                      <p className="text-foreground">
                        Crea este registro <strong>TXT</strong> en tu proveedor de dominio y toca «Verificar ahora». Puede tardar desde minutos hasta 48
                        horas.
                      </p>
                      <p className="break-all rounded-md border border-border bg-surface p-3 font-mono text-xs">
                        {item.verification.name} → {item.verification.value}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {verify.isError ? (
          <p role="alert" className="text-sm text-danger">
            {serverMessage(verify.error, "No se pudo verificar ahora. Intenta de nuevo.")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
