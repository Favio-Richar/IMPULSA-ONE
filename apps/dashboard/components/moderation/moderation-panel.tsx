"use client";

import type { ModerationCaseResponse } from "@impulza/contracts";
import { ABUSE_REPORT_REASON_LABELS, APPEAL_TEXT_MAX, APPEAL_TEXT_MIN } from "@impulza/validation";
import { Button, EmptyState, ErrorState, LoadingState, Textarea } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { appealModerationCase, listModerationCases } from "../../lib/api/moderation";

const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" });

const MEASURE_LABELS: Record<NonNullable<ModerationCaseResponse["measure"]>, { title: string; effect: string }> = {
  WARNED: { title: "Advertencia", effect: "Tu página sigue publicada." },
  SITE_UNPUBLISHED: { title: "Página despublicada", effect: "Tu página no se muestra al público. Tu contenido sigue intacto en tu panel." },
  ORG_SUSPENDED: {
    title: "Organización suspendida",
    effect: "Tus páginas no se muestran al público y tu panel está en solo lectura. Puedes ver y exportar tus datos.",
  },
};

function statusLabel(item: ModerationCaseResponse): { text: string; tone: string } {
  if (item.status === "APPEALED") return { text: "Apelación en revisión", tone: "border-primary/30 bg-primary/5 text-primary" };
  if (item.status === "DISMISSED") return { text: "Medida retirada", tone: "border-border bg-surface text-muted-foreground" };
  return { text: "Medida vigente", tone: "border-warning/30 bg-warning/5 text-warning" };
}

function errorText(error: unknown): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return "No pudimos enviar tu apelación. Intenta de nuevo en un momento.";
}

/**
 * Medidas de moderación sobre el negocio y su apelación (F9.9d). Funciona también con la organización suspendida: apelar
 * es justamente el camino para salir de una suspensión. Nunca muestra el texto del reporte ni datos de quien denunció.
 */
export function ModerationPanel({ organizationId }: { organizationId: string }): React.JSX.Element {
  const query = useQuery({ queryKey: ["moderation-cases", organizationId], queryFn: () => listModerationCases(organizationId) });

  if (query.isPending) return <LoadingState label="Cargando medidas…" />;
  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.status === 403;
    return forbidden ? (
      <EmptyState title="No tienes acceso a esta sección" description="Solo el propietario y los administradores pueden ver y apelar las medidas de moderación." />
    ) : (
      <ErrorState onRetry={() => query.refetch()} />
    );
  }
  if (query.data.length === 0) {
    return (
      <EmptyState
        title="Sin medidas de moderación"
        description="Tu negocio no tiene advertencias, páginas despublicadas ni suspensiones. Si alguien reporta una página tuya y el equipo toma una medida, la verás aquí con su explicación."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-4" aria-label="Medidas de moderación">
      {query.data.map((item) => (
        <CaseCard key={item.id} organizationId={organizationId} item={item} />
      ))}
    </ul>
  );
}

function CaseCard({ organizationId, item }: { organizationId: string; item: ModerationCaseResponse }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const measure = item.measure ? MEASURE_LABELS[item.measure] : null;
  const status = statusLabel(item);

  const appeal = useMutation({
    mutationFn: () => appealModerationCase(organizationId, item.id, text.trim()),
    onSuccess: () => {
      setOpen(false);
      setText("");
      void queryClient.invalidateQueries({ queryKey: ["moderation-cases", organizationId] });
    },
  });

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (text.trim().length < APPEAL_TEXT_MIN) {
      setInvalid(`Cuéntanos por qué la medida no corresponde (al menos ${APPEAL_TEXT_MIN} caracteres).`);
      return;
    }
    setInvalid(null);
    appeal.mutate();
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-base font-semibold text-foreground">{measure?.title ?? "Caso resuelto"}</h2>
          <p className="text-sm text-muted-foreground">
            {item.site.name} · Reporte por: {ABUSE_REPORT_REASON_LABELS[item.reason]}
            {item.decidedAt ? ` · ${dateFormat.format(new Date(item.decidedAt))}` : ""}
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${status.tone}`}>{status.text}</span>
      </div>

      {measure ? <p className="text-sm text-foreground">{measure.effect}</p> : null}

      {item.statement ? (
        <div className="flex flex-col gap-1 rounded-md bg-surface p-3">
          <p className="text-xs font-medium text-muted-foreground">Explicación del equipo</p>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{item.statement}</p>
        </div>
      ) : null}

      {item.appealText ? (
        <div className="flex flex-col gap-1 rounded-md border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Tu apelación{item.appealedAt ? ` · ${dateFormat.format(new Date(item.appealedAt))}` : ""}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{item.appealText}</p>
          {item.status === "APPEALED" ? (
            <p className="text-xs text-muted-foreground">Una persona del equipo la está revisando. La medida sigue vigente mientras tanto.</p>
          ) : null}
        </div>
      ) : null}

      {item.canAppeal ? (
        open ? (
          <form noValidate onSubmit={submit} className="flex flex-col gap-3">
            <Textarea
              label="¿Por qué crees que la medida no corresponde?"
              autoFocus
              rows={5}
              maxLength={APPEAL_TEXT_MAX}
              value={text}
              onChange={(event) => setText(event.target.value)}
              error={invalid ?? undefined}
              helperText={`Texto plano, de ${APPEAL_TEXT_MIN} a ${APPEAL_TEXT_MAX} caracteres. Solo puedes apelar una vez cada decisión.`}
            />
            {appeal.isError ? (
              <p role="alert" className="text-sm text-danger">
                {errorText(appeal.error)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={appeal.isPending}>
                Enviar apelación
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button variant="secondary" aria-expanded={false} onClick={() => setOpen(true)}>
              Apelar esta medida
            </Button>
          </div>
        )
      ) : item.status === "DISMISSED" || item.status === "APPEALED" ? null : (
        <p className="text-xs text-muted-foreground">Ya apelaste esta decisión. Si necesitas ayuda, escríbenos desde Soporte.</p>
      )}
    </li>
  );
}
