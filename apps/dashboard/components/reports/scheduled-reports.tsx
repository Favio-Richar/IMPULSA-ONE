"use client";

import type { ReportRunResponse, ReportScheduleResponse } from "@impulza/contracts";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Input, LoadingState, Select } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, apiFetch } from "../../lib/api-client";
import { ConfirmButton } from "../confirm-button";

// Informes programados (F9.8c, ADR-028 §6): un correo semanal o mensual con las cifras del periodo anterior y un enlace de solo lectura.
// El servidor decide cuándo corre (lunes o día 1, 08:00 UTC) y registra cada ejecución; aquí solo se administran y se ven.

const schedulesKey = (organizationId: string) => ["report-schedules", organizationId] as const;
const runsKey = (organizationId: string) => ["report-runs", organizationId] as const;
const base = (organizationId: string) => `/organizations/${organizationId}/reports/schedules`;

const FREQUENCIES = [
  { value: "WEEKLY", label: "Cada semana (lunes)" },
  { value: "MONTHLY", label: "Cada mes (día 1)" },
];

const FREQUENCY_TEXT: Record<ReportScheduleResponse["frequency"], string> = { WEEKLY: "Cada semana", MONTHLY: "Cada mes" };

const RUN_STATUS: Record<ReportRunResponse["status"], { label: string; tone: string }> = {
  PENDING: { label: "En curso", tone: "text-muted-foreground" },
  SENT: { label: "Enviado", tone: "text-success" },
  FAILED: { label: "Falló", tone: "text-danger" },
};

const ERROR_TEXT: Record<string, string> = {
  SEND_FAILED: "No se pudo enviar el correo.",
  BUILD_FAILED: "No se pudo armar el informe.",
  PLAN_LIMIT: "Tu plan ya no cubre ese periodo.",
  ORGANIZATION_INACTIVE: "La organización estaba bloqueada.",
  SCHEDULE_DISABLED: "La programación estaba pausada.",
};

function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

function dateText(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}

function parseRecipients(text: string): string[] {
  return text
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export function ScheduledReports({ organizationId }: { organizationId: string }): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const [frequency, setFrequency] = useState("WEEKLY");
  const [recipients, setRecipients] = useState("");
  const [label, setLabel] = useState("");

  const schedules = useQuery({ queryKey: schedulesKey(organizationId), queryFn: () => apiFetch<ReportScheduleResponse[]>(base(organizationId)) });
  const runs = useQuery({ queryKey: runsKey(organizationId), queryFn: () => apiFetch<ReportRunResponse[]>(`${base(organizationId)}/runs`) });

  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: schedulesKey(organizationId) }), queryClient.invalidateQueries({ queryKey: runsKey(organizationId) })]);
  };
  const create = useMutation({
    mutationFn: () =>
      apiFetch<ReportScheduleResponse>(base(organizationId), {
        method: "POST",
        body: { frequency, recipients: parseRecipients(recipients), label: label.trim() === "" ? null : label.trim() },
      }),
    onSuccess: async () => {
      setRecipients("");
      setLabel("");
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (schedule: ReportScheduleResponse) => apiFetch<ReportScheduleResponse>(`${base(organizationId)}/${schedule.id}`, { method: "PATCH", body: { enabled: !schedule.enabled } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<{ deleted: true }>(`${base(organizationId)}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  // Quien no puede compartir informes (p. ej. el cliente en su portal) no ve esta sección: no es un error, es que no le corresponde.
  if (schedules.isError && schedules.error instanceof ApiError && schedules.error.status === 403) return null;

  return (
    <Card className="print:hidden" data-testid="scheduled-reports">
      <CardHeader>
        <CardTitle>Informes programados</CardTitle>
        <CardDescription>
          Recibe (o envía a tu cliente) un correo con las cifras del periodo anterior y un enlace de solo lectura. Se envía el lunes (semanal) o el día 1
          (mensual), a las 08:00 UTC.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[12rem_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Select label="Frecuencia" value={frequency} onChange={(event) => setFrequency(event.target.value)} options={FREQUENCIES} />
          <Input
            label="Destinatarios (máximo 5, separados por coma)"
            type="text"
            value={recipients}
            onChange={(event) => setRecipients(event.target.value)}
            placeholder="cliente@empresa.cl, socio@empresa.cl"
          />
          <Button type="submit" loading={create.isPending}>
            Programar
          </Button>
        </form>
        <Input label="Nombre (opcional)" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder="Informe mensual del cliente" />
        {create.isError ? (
          <p role="alert" className="text-sm text-danger">
            {serverMessage(create.error, "No pudimos programar el informe. Intenta de nuevo.")}
          </p>
        ) : null}

        {schedules.isPending ? (
          <LoadingState label="Cargando programaciones…" />
        ) : schedules.isError ? (
          <ErrorState onRetry={() => void schedules.refetch()} />
        ) : schedules.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no programaste ningún informe.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border" aria-label="Informes programados">
            {schedules.data.map((schedule) => (
              <li key={schedule.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="report-schedule" data-enabled={schedule.enabled}>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {schedule.label ?? FREQUENCY_TEXT[schedule.frequency]} · {FREQUENCY_TEXT[schedule.frequency].toLowerCase()}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{schedule.recipients.join(", ")}</span>
                  <span className="text-xs text-muted-foreground">
                    {schedule.enabled ? `Próximo envío: ${dateText(schedule.nextRunAt)}` : "En pausa"}
                    {schedule.lastRunAt ? ` · último: ${dateText(schedule.lastRunAt)}` : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="secondary" loading={toggle.isPending && toggle.variables?.id === schedule.id} onClick={() => toggle.mutate(schedule)}>
                    {schedule.enabled ? "Pausar" : "Reanudar"}
                  </Button>
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    confirmLabel="¿Eliminar?"
                    loading={remove.isPending && remove.variables === schedule.id}
                    onConfirm={() => remove.mutate(schedule.id)}
                  >
                    Eliminar
                  </ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        {toggle.isError || remove.isError ? (
          <p role="alert" className="text-sm text-danger">
            {serverMessage(toggle.error ?? remove.error, "No pudimos aplicar el cambio. Intenta de nuevo.")}
          </p>
        ) : null}

        {runs.isSuccess && runs.data.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground">Últimos envíos</h3>
            <ul className="flex flex-col divide-y divide-border" aria-label="Últimos envíos" data-testid="report-runs">
              {runs.data.slice(0, 8).map((run) => (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-status={run.status}>
                  <span className="text-foreground">
                    {run.period.from} a {run.period.to}
                  </span>
                  <span className={RUN_STATUS[run.status].tone}>
                    {RUN_STATUS[run.status].label}
                    {run.status === "SENT" ? ` · ${run.deliveredCount} ${run.deliveredCount === 1 ? "destinatario" : "destinatarios"}` : ""}
                    {run.status === "FAILED" && run.errorCode ? ` · ${ERROR_TEXT[run.errorCode] ?? "Error al enviar."}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
