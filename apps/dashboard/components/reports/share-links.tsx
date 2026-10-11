"use client";

import type { CreatedReportShareLinkResponse, ReportShareLinkResponse } from "@impulza/contracts";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Select } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, apiFetch } from "../../lib/api-client";
import { env } from "../../lib/env";
import { ConfirmButton } from "../confirm-button";

// Enlaces compartidos del informe (F9.8b, ADR-028 §6): solo lectura, con vencimiento y revocables. El enlace completo se muestra UNA vez
// al crearlo (el servidor solo guarda su hash).

const key = (organizationId: string) => ["report-share-links", organizationId] as const;
const base = (organizationId: string) => `/organizations/${organizationId}/reports/share-links`;

const DAYS = [
  { value: "7", label: "7 días" },
  { value: "14", label: "14 días" },
  { value: "30", label: "30 días" },
  { value: "90", label: "90 días" },
];

function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

function dateText(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

export function ShareLinks({ organizationId, from, to }: { organizationId: string; from: string; to: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("14");
  const [created, setCreated] = useState<CreatedReportShareLinkResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const list = useQuery({ queryKey: key(organizationId), queryFn: () => apiFetch<ReportShareLinkResponse[]>(base(organizationId)) });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<CreatedReportShareLinkResponse>(base(organizationId), {
        method: "POST",
        body: { from, to, label: label.trim() === "" ? null : label.trim(), expiresInDays: Number(days) },
      }),
    onSuccess: async (link) => {
      setCreated(link);
      setCopied(false);
      setLabel("");
      await queryClient.invalidateQueries({ queryKey: key(organizationId) });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch<ReportShareLinkResponse>(`${base(organizationId)}/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(organizationId) }),
  });

  // El enlace completo (con el token) solo existe en esta respuesta.
  const url = created ? `${env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/$/, "")}/informe/${created.token}` : null;

  return (
    <Card className="print:hidden" data-testid="share-links">
      <CardHeader>
        <CardTitle>Compartir este informe</CardTitle>
        <CardDescription>
          Crea un enlace de solo lectura para quien no tiene cuenta: ve estas cifras (sin datos personales de tus contactos) hasta que venza o lo
          revoques.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_10rem_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Input label="Nombre del enlace (opcional)" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder="Para el cliente, octubre" />
          <Select label="Vence en" value={days} onChange={(event) => setDays(event.target.value)} options={DAYS} />
          <Button type="submit" loading={create.isPending}>
            Crear enlace
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">Incluye el periodo que estás viendo: {from} a {to}.</p>
        {create.isError ? (
          <p role="alert" className="text-sm text-danger">
            {serverMessage(create.error, "No pudimos crear el enlace. Intenta de nuevo.")}
          </p>
        ) : null}

        {url ? (
          <div className="flex flex-col gap-2 rounded-md border border-success/40 bg-success/10 p-3" role="status" data-testid="share-link-created">
            <p className="text-sm font-medium text-foreground">Enlace creado. Cópialo ahora: no se vuelve a mostrar.</p>
            <input readOnly value={url} aria-label="Enlace del informe" className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={() => {
                void navigator.clipboard.writeText(url).then(() => setCopied(true));
              }}
            >
              {copied ? "Copiado" : "Copiar enlace"}
            </Button>
          </div>
        ) : null}

        {list.isSuccess && list.data.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border" aria-label="Enlaces creados">
            {list.data.map((link) => (
              <li key={link.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="share-link" data-active={link.active}>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {link.label ?? "Informe"} · {link.period.from} a {link.period.to}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {link.revokedAt ? "Revocado" : link.active ? `Vence el ${dateText(link.expiresAt)}` : `Venció el ${dateText(link.expiresAt)}`} ·{" "}
                    {link.accessCount} {link.accessCount === 1 ? "visita" : "visitas"}
                  </span>
                </div>
                {link.active ? (
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    confirmLabel="¿Revocar el enlace?"
                    loading={revoke.isPending && revoke.variables === link.id}
                    onConfirm={() => revoke.mutate(link.id)}
                  >
                    Revocar
                  </ConfirmButton>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {revoke.isError ? (
          <p role="alert" className="text-sm text-danger">
            {serverMessage(revoke.error, "No pudimos revocar el enlace.")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
