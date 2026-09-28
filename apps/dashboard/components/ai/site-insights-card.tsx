"use client";

import type { AiInsightsResponse } from "@impulza/contracts";
import { Button, cn } from "@impulza/ui";
import { AI_INSIGHT_ACTION_LABELS, AI_INSIGHTS_PERIODS, type AiInsightsPeriod } from "@impulza/validation";
import { ArrowUpRight, Info, Lightbulb, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { healthMessage } from "../../lib/page-health-messages";
import { useAiStatus, useAnalyzeSite } from "../../lib/hooks/use-ai";
import { AiErrorNotice, Intro, QuotaLine } from "./ai-assistant-dialogs";

const DATE_FORMAT = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone: "UTC" });

function formatDay(day: string): string {
  return DATE_FORMAT.format(new Date(`${day}T00:00:00.000Z`));
}

/**
 * Lectura comercial con IA (F6.4) en la pantalla de analítica: explica los números del sitio y
 * propone hasta 3 acciones. La muestra suficiente la decide el servidor; si no alcanza, esta tarjeta
 * lo dice con un aviso propio, sin depender de que el texto del modelo lo mencione.
 */
export function SiteInsightsCard({
  organizationId,
  siteId,
  initialDays,
}: {
  organizationId: string;
  siteId: string;
  initialDays: AiInsightsPeriod;
}): React.JSX.Element {
  const status = useAiStatus(organizationId);
  const mutation = useAnalyzeSite(organizationId);
  const [days, setDays] = useState<AiInsightsPeriod>(initialDays);
  const data = mutation.data;

  return (
    <section aria-labelledby="lectura-ia-titulo" className="flex flex-col gap-4 rounded-lg border border-primary/25 bg-background p-4 shadow-xs sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 id="lectura-ia-titulo" className="text-base font-semibold text-foreground">
              Lectura con IA
            </h2>
            <p className="text-sm text-muted-foreground">Qué dicen tus números y qué hacer ahora. Solo métricas agregadas, sin datos personales.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Período a analizar" className="inline-flex rounded-md border border-border-strong p-0.5">
            {AI_INSIGHTS_PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                aria-pressed={days === period}
                onClick={() => setDays(period)}
                className={cn(
                  "h-8 rounded-sm px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                  days === period ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface",
                )}
              >
                {period} días
              </button>
            ))}
          </div>
          <Button type="button" size="sm" variant={data ? "secondary" : "primary"} loading={mutation.isPending} onClick={() => mutation.mutate({ siteId, days })}>
            <Sparkles className="size-4" aria-hidden="true" />
            {data ? "Analizar de nuevo" : "Analizar"}
          </Button>
        </div>
      </div>

      <QuotaLine status={status.data} lead="Solo lectura: no cambia nada en tu sitio." />

      <div aria-live="polite" className="flex flex-col gap-4">
        {mutation.isPending ? (
          <div role="status" className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="size-4 animate-pulse text-primary" aria-hidden="true" />
              Leyendo tus métricas…
            </p>
            <div className="h-4 w-11/12 animate-pulse rounded bg-surface" aria-hidden="true" />
            <div className="h-4 w-8/12 animate-pulse rounded bg-surface" aria-hidden="true" />
            <div className="grid gap-3 md:grid-cols-3" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-28 animate-pulse rounded-md bg-surface" />
              ))}
            </div>
          </div>
        ) : mutation.isError ? (
          <AiErrorNotice error={mutation.error} />
        ) : data ? (
          <InsightsResult data={data} />
        ) : (
          <Intro icon={Lightbulb}>Elige el período y aprieta «Analizar». Nada se cambia en tu sitio: son recomendaciones para que decidas.</Intro>
        )}
      </div>
    </section>
  );
}

function InsightsResult({ data }: { data: AiInsightsResponse }): React.JSX.Element {
  return (
    <>
      {!data.sample.enough ? (
        <div role="note" className="flex gap-3 rounded-md border border-info/30 bg-info/5 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <p className="text-foreground">
            Todavía hay pocas visitas para hablar de tendencias ({data.sample.visitors} de {data.sample.minimum} visitantes en el período). Las
            recomendaciones se enfocan en tu página y en conseguir más visitas.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">
          {formatDay(data.range.from)} – {formatDay(data.range.to)}
          {data.comparedTo ? ` · comparado con ${formatDay(data.comparedTo.from)} – ${formatDay(data.comparedTo.to)}` : null}
        </p>
        <p className="text-[0.95rem] leading-relaxed text-foreground">{data.summary}</p>
      </div>

      <ol className="grid gap-3 md:grid-cols-3" aria-label="Acciones recomendadas">
        {data.actions.map((action, index) => (
          <li key={`${index}-${action.title}`} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="rounded-sm bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{AI_INSIGHT_ACTION_LABELS[action.kind]}</span>
            </div>
            <p className="font-medium text-foreground">{action.title}</p>
            <p className="text-sm text-muted-foreground">{action.reason}</p>
            <FixLink siteId={data.siteId} pageId={data.health?.pageId ?? null} findingCode={action.findingCode} />
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">Generado con IA. Revisa cada recomendación antes de aplicarla.</p>
    </>
  );
}

/** Si la acción corrige un hallazgo de la salud de página, lleva a donde se corrige. */
function FixLink({ siteId, pageId, findingCode }: { siteId: string; pageId: string | null; findingCode: string | null }): React.JSX.Element | null {
  if (!findingCode || !pageId) {
    return null;
  }
  const fix = healthMessage(findingCode).fix;
  const target =
    fix === "seo"
      ? { href: `/sitios/${siteId}/paginas/${pageId}#seo`, label: "Editar SEO" }
      : fix === "theme"
        ? { href: `/sitios/${siteId}`, label: "Cambiar tema" }
        : fix
          ? { href: `/sitios/${siteId}/paginas/${pageId}/editor`, label: "Abrir el constructor" }
          : null;
  if (!target) {
    return null;
  }
  return (
    <Link href={target.href} className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
      {target.label}
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}
