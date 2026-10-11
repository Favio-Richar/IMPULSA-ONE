"use client";

import type { AdminAbuseReportDetailResponse } from "@impulza/contracts";
import { ABUSE_REPORT_REASON_LABELS, MODERATION_ACTION_LABELS, type ModerationAction } from "@impulza/validation";
import { Button, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { MODERATION_ACTION_HELP, MODERATION_CONFIRM_ACTIONS, ModerationStatusBadge } from "../../../../components/moderation-bits";
import { ReasonField, reasonError } from "../../../../components/reason-field";
import { PageHeader, Section } from "../../../../components/ui-bits";
import { adminApi } from "../../../../lib/api";
import { ApiError } from "../../../../lib/api-client";
import { formatDateTime } from "../../../../lib/format";

type Detail = AdminAbuseReportDetailResponse;

export default function ModerationReportPage(): React.JSX.Element {
  const { reportId } = useParams<{ reportId: string }>();
  const reportQuery = useQuery({ queryKey: ["admin", "abuse-report", reportId], queryFn: () => adminApi.abuseReport(reportId), retry: false });

  const back = (
    <Link href="/moderacion" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Moderación
    </Link>
  );

  if (reportQuery.isPending) {
    return <LoadingState label="Cargando el reporte…" />;
  }
  if (reportQuery.isError) {
    const notFound = reportQuery.error instanceof ApiError && (reportQuery.error.status === 404 || reportQuery.error.status === 400);
    return (
      <div className="flex flex-col gap-6">
        {back}
        {notFound ? <EmptyState title="No encontramos ese reporte" /> : <ErrorState onRetry={() => reportQuery.refetch()} />}
      </div>
    );
  }

  const report = reportQuery.data;

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        title={`${ABUSE_REPORT_REASON_LABELS[report.reason]} · ${report.site.name}`}
        description={`Recibido el ${formatDateTime(report.createdAt)}`}
        actions={<ModerationStatusBadge status={report.status} />}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <Section title="Lo que dijo quien reportó">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{report.details ?? "No escribió ningún detalle."}</p>
            <p className="text-xs text-muted-foreground">
              Correo de contacto: {report.reporterEmail ?? "no lo dejó"}. Solo lo ve superadministración; nunca se le muestra al propietario. Abrir este reporte quedó registrado en la auditoría.
            </p>
          </Section>

          {report.appealText ? (
            <Section title="Apelación del propietario">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{report.appealText}</p>
              {report.appealedAt ? <p className="text-xs text-muted-foreground">Enviada el {formatDateTime(report.appealedAt)}.</p> : null}
            </Section>
          ) : null}

          {report.availableActions.length > 0 ? (
            <ActionPanel report={report} />
          ) : (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
              Este caso está cerrado. {report.resolution ? `Última decisión: ${report.resolution}` : ""}
            </p>
          )}

          <Section title="Historial de decisiones">
            {report.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay decisiones sobre este reporte.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {report.history.map((entry) => (
                  <li key={entry.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3 text-sm">
                    <span className="font-medium text-foreground">{labelFor(entry.action)}</span>
                    {entry.reason ? <span className="whitespace-pre-wrap break-words text-foreground">{entry.reason}</span> : null}
                    <span className="text-xs text-muted-foreground">
                      {entry.actorEmail ?? "Cuenta eliminada"} · {formatDateTime(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <Section title="Sitio y organización" className="xl:self-start">
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">Sitio</dt>
              <dd className="font-medium text-foreground">
                {report.site.name} <span className="font-normal text-muted-foreground">({report.site.slug})</span>
              </dd>
              <dd className="text-xs text-muted-foreground">{report.site.hidden ? "Despublicado por moderación" : "Visible al público"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">Organización</dt>
              <dd className="font-medium text-foreground">{report.organization.name}</dd>
              <dd className="text-xs text-muted-foreground">{report.organization.blocked ? "Bloqueada" : "Activa"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">Reportes abiertos de este sitio</dt>
              <dd className="font-medium text-foreground">{report.siteOpenReports}</dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/organizaciones/${report.organization.id}`}>Ver organización</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/moderacion?organizationId=${report.organization.id}`}>Otros reportes de esta organización</Link>
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

function labelFor(action: string): string {
  const key = action.replace("admin.abuse_report_", "") as ModerationAction;
  return MODERATION_ACTION_LABELS[key] ?? action;
}

function ActionPanel({ report }: { report: Detail }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<ModerationAction | null>(null);
  const [reason, setReason] = useState("");
  const [showError, setShowError] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const mutation = useMutation({
    mutationFn: () => adminApi.moderate(report.id, action as ModerationAction, reason.trim()),
    onSuccess: (detail) => {
      queryClient.setQueryData(["admin", "abuse-report", report.id], detail);
      void queryClient.invalidateQueries({ queryKey: ["admin", "abuse-reports"] });
      setAction(null);
      setReason("");
      setConfirming(false);
      setShowError(false);
    },
    onError: () => setConfirming(false),
  });

  const failure = mutation.error;
  const invalid = reasonError(reason);

  function submit(): void {
    if (!action) return;
    if (invalid) {
      setShowError(true);
      return;
    }
    if (MODERATION_CONFIRM_ACTIONS.has(action) && !confirming) {
      setConfirming(true);
      return;
    }
    mutation.mutate();
  }

  return (
    <Section title="Decisión">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Acción a aplicar</legend>
        {report.availableActions.map((candidate) => (
          // Toda la tarjeta es la etiqueta (área clicable completa). El nombre accesible del radio es solo el título
          // (`aria-labelledby`); la explicación se anuncia como descripción y no se mezcla con otros campos.
          <label
            key={candidate}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-foreground"
          >
            <input
              type="radio"
              name="moderation-action"
              className="mt-1"
              aria-labelledby={`action-${candidate}-title`}
              aria-describedby={`action-${candidate}-help`}
              checked={action === candidate}
              onChange={() => {
                setAction(candidate);
                setConfirming(false);
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span id={`action-${candidate}-title`} className="font-medium text-foreground">
                {MODERATION_ACTION_LABELS[candidate]}
              </span>
              <span id={`action-${candidate}-help`} className="text-muted-foreground">
                {MODERATION_ACTION_HELP[candidate]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {action ? (
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <ReasonField
            label="Motivo"
            value={reason}
            onChange={(value) => {
              setReason(value);
              setConfirming(false);
            }}
            error={showError ? invalid : undefined}
            helperText="El propietario lo lee tal cual (salvo al descartar). Quedan registrados en la auditoría con tu nombre."
          />
          {failure ? (
            <p role="alert" className="text-sm text-danger">
              {failure instanceof ApiError ? failure.messageOr("No se pudo aplicar la acción.") : "No se pudo aplicar la acción."}
            </p>
          ) : null}
          {confirming ? (
            <p role="alert" className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
              Vas a aplicar «{MODERATION_ACTION_LABELS[action]}» sobre un negocio real. Confirma para continuar.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {confirming ? (
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            ) : null}
            <Button type="submit" loading={mutation.isPending}>
              {confirming ? "Sí, aplicar" : MODERATION_ACTION_LABELS[action]}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Elige una acción para escribir el motivo.</p>
      )}
    </Section>
  );
}
