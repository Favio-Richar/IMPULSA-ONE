"use client";

import type { ReportCommentResponse } from "@impulza/contracts";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, apiFetch } from "../../lib/api-client";

// Comentarios del informe (F9.8d, ADR-028 §6): la agencia o el equipo anota sobre el periodo y el cliente responde desde su portal.
// El hilo es del periodo que se está viendo; el texto se muestra siempre como texto plano.

const BODY_MAX = 1000;

function dateText(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

export function ReportComments({ organizationId, from, to }: { organizationId: string; from: string; to: string }): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const url = `/organizations/${organizationId}/reports/comments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const key = ["report-comments", organizationId, from, to] as const;

  const list = useQuery({ queryKey: key, queryFn: () => apiFetch<ReportCommentResponse[]>(url) });
  const add = useMutation({
    mutationFn: () => apiFetch<ReportCommentResponse>(url, { method: "POST", body: { body: body.trim() } }),
    onSuccess: async () => {
      setBody("");
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });

  // Quien no puede comentar (p. ej. el rol de solo lectura) no ve la sección: no es un error, es que no le corresponde.
  if (list.isError && list.error instanceof ApiError && list.error.status === 403) return null;

  return (
    <Card className="print:hidden" data-testid="report-comments">
      <CardHeader>
        <CardTitle>Comentarios</CardTitle>
        <CardDescription>Notas sobre este periodo, entre quien prepara el informe y el cliente.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {list.isPending ? (
          <LoadingState label="Cargando comentarios…" />
        ) : list.isError ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : list.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay comentarios en este periodo.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Comentarios del periodo">
            {list.data.map((comment) => (
              <li
                key={comment.id}
                className={`flex flex-col gap-1 rounded-md border p-3 ${comment.fromClient ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30"}`}
                data-testid="report-comment"
                data-from-client={comment.fromClient}
              >
                <span className="text-xs text-muted-foreground">
                  {comment.fromClient ? "Cliente" : "Equipo"} · {comment.author?.email ?? "Cuenta eliminada"} · {dateText(comment.createdAt)}
                </span>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim() !== "") add.mutate();
          }}
        >
          <label htmlFor="report-comment-body" className="text-sm font-medium text-foreground">
            Escribe un comentario
          </label>
          <textarea
            id="report-comment-body"
            value={body}
            maxLength={BODY_MAX}
            rows={3}
            onChange={(event) => setBody(event.target.value)}
            className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {body.length}/{BODY_MAX}
            </span>
            <Button type="submit" size="sm" loading={add.isPending} disabled={body.trim() === ""}>
              Comentar
            </Button>
          </div>
          {add.isError ? (
            <p role="alert" className="text-sm text-danger">
              {serverMessage(add.error, "No pudimos guardar el comentario. Intenta de nuevo.")}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
