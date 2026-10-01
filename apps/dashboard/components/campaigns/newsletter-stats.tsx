"use client";

import type { NewsletterStatsResponse } from "@impulza/contracts";
import { useQuery } from "@tanstack/react-query";
import { MailCheck, MailPlus, Send, Users } from "lucide-react";
import { apiFetch } from "../../lib/api-client";

const STATS: ReadonlyArray<{ key: keyof NewsletterStatsResponse; label: string; hint: string; icon: typeof Users }> = [
  { key: "marketingAudience", label: "Audiencia de campañas", hint: "Aceptaron recibir correos y no se dieron de baja.", icon: Users },
  { key: "confirmedSubscribers", label: "Por la newsletter", hint: "Confirmaron desde su correo (doble confirmación).", icon: MailCheck },
  { key: "confirmedLast30Days", label: "Nuevos (30 días)", hint: "Confirmaciones del último mes.", icon: MailPlus },
  { key: "pendingConfirmations", label: "Por confirmar", hint: "Pidieron suscribirse y todavía no abren el correo (vence a las 48 h).", icon: Send },
];

/**
 * Suscriptores (F7.4, ADR-019): cuántos recibirán una campaña y cuántos llegaron por el bloque de
 * newsletter. Los pendientes no cuentan para nada hasta que confirman.
 */
export function NewsletterStats({ organizationId }: { organizationId: string }): React.JSX.Element | null {
  const query = useQuery({
    queryKey: ["newsletter-stats", organizationId],
    queryFn: () => apiFetch<NewsletterStatsResponse>(`/organizations/${organizationId}/newsletter/stats`),
    refetchInterval: 60_000,
  });

  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        No pudimos cargar los suscriptores.{" "}
        <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={() => void query.refetch()}>
          Reintentar
        </button>
      </p>
    );
  }

  return (
    <section aria-label="Suscriptores" className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy={query.isPending || undefined}>
      {STATS.map(({ key, label, hint, icon: Icon }) => (
        <div key={key} className="flex flex-col gap-1 rounded-lg border border-border bg-background p-4 shadow-xs" title={hint}>
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
            {label}
          </span>
          <span className="text-2xl font-semibold tabular-nums text-foreground" data-stat={key}>
            {query.isPending ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-surface motion-reduce:animate-none" aria-hidden="true" /> : query.data[key].toLocaleString("es-CL")}
          </span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
      ))}
    </section>
  );
}
