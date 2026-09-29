"use client";

import type { AbTestResponse } from "@impulza/contracts";
import { Button, cn } from "@impulza/ui";
import { AB_TEST_FIELD_LABELS, isBlockType } from "@impulza/validation";
import { CheckCircle2, FlaskConical, Info, Timer, Trophy } from "lucide-react";
import Link from "next/link";
import { abTestErrorMessage, formatRate, verdictSummary } from "../../lib/ab-test-messages";
import { BLOCK_LABELS } from "../../lib/block-fields/labels";
import { useApplyAbTest, useStopAbTest } from "../../lib/hooks/use-ab-tests";
import { ConfirmButton } from "../confirm-button";
import { PlanLimitNotice } from "../plan-limit-notice";

const DATE = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric" });
const INTEGER = new Intl.NumberFormat("es-CL");

function count(value: number, singular: string, plural: string): string {
  return `${INTEGER.format(value)} ${value === 1 ? singular : plural}`;
}

const STYLE_LABELS: Record<string, string> = { primary: "Principal", secondary: "Secundario", outline: "Contorno" };

function displayValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "—";
  }
  if (field === "style" && typeof value === "string") {
    return STYLE_LABELS[value] ?? value;
  }
  return String(value);
}

const TONE: Record<ReturnType<typeof verdictSummary>["tone"], { box: string; icon: typeof Info }> = {
  neutral: { box: "border-border bg-surface", icon: Timer },
  info: { box: "border-info/30 bg-info/5", icon: Info },
  success: { box: "border-success/30 bg-success/5", icon: Trophy },
};

/**
 * Una prueba A/B con sus resultados (F6.5): qué cambia entre A y B, visitas, clics y conversiones
 * por variante, el veredicto del servidor y las acciones explícitas (terminar, aplicar). Aplicar B
 * escribe el borrador del bloque; nada se publica solo.
 */
export function AbTestCard({ organizationId, siteId, test }: { organizationId: string; siteId: string; test: AbTestResponse }): React.JSX.Element {
  const stop = useStopAbTest(organizationId, siteId);
  const apply = useApplyAbTest(organizationId, siteId);
  const { results } = test;
  const verdict = verdictSummary(results);
  const Tone = TONE[verdict.tone];
  const fields = Object.keys(test.variantB);
  const blockLabel = isBlockType(test.blockType) ? BLOCK_LABELS[test.blockType] : test.blockType;
  const maxRate = Math.max(results.rateA ?? 0, results.rateB ?? 0, 0.0001);
  const running = test.status === "RUNNING";
  const error = stop.error ?? apply.error;

  return (
    <article aria-labelledby={`prueba-${test.id}`} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 shadow-xs sm:p-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FlaskConical className="size-4" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-0.5">
            <h3 id={`prueba-${test.id}`} className="font-semibold text-foreground">
              {test.name}
            </h3>
            <p className="text-sm text-muted-foreground">
              {blockLabel} · desde el {DATE.format(new Date(test.startedAt))}
              {test.endedAt ? ` hasta el ${DATE.format(new Date(test.endedAt))}` : ""}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium",
            running ? "bg-primary/10 text-primary" : "bg-surface text-muted-foreground",
          )}
        >
          <span className={cn("size-1.5 rounded-full", running ? "bg-primary" : "bg-muted-foreground")} aria-hidden="true" />
          {running ? "En curso" : test.appliedVariant ? `Terminada · aplicada ${test.appliedVariant.toUpperCase()}` : "Terminada"}
        </span>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {(["a", "b"] as const).map((variant) => {
          const counts = results[variant];
          const rate = variant === "a" ? results.rateA : results.rateB;
          const isWinner = results.winner === variant;
          return (
            <section
              key={variant}
              aria-label={`Variante ${variant.toUpperCase()}`}
              className={cn("flex flex-col gap-3 rounded-md border p-3", isWinner ? "border-success/50 bg-success/5" : "border-border bg-surface")}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  Variante {variant.toUpperCase()} <span className="font-normal text-muted-foreground">{variant === "a" ? "· la actual" : "· la nueva"}</span>
                </p>
                {isWinner ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    Ganadora
                  </span>
                ) : null}
              </div>
              <dl className="flex flex-col gap-1.5">
                {fields.map((field) => (
                  <div key={field} className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{AB_TEST_FIELD_LABELS[field] ?? field}</dt>
                    <dd className="break-words text-sm text-foreground">
                      {displayValue(field, variant === "a" ? test.variantA[field] : test.variantB[field])}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Clics por visita</span>
                  <span className="font-semibold tabular-nums text-foreground">{formatRate(rate)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background" aria-hidden="true">
                  <div
                    className={cn("h-full rounded-full", variant === "a" ? "bg-muted-foreground/60" : "bg-primary")}
                    style={{ width: `${Math.round(((rate ?? 0) / maxRate) * 100)}%` }}
                  />
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {count(counts.exposures, "visita", "visitas")} · {count(counts.clicks, "clic", "clics")} · {count(counts.conversions, "conversión", "conversiones")}
                </p>
              </div>
            </section>
          );
        })}
      </div>

      <div role="status" className={cn("flex gap-3 rounded-md border p-3 text-sm", Tone.box)}>
        <Tone.icon className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <p className="font-medium text-foreground">{verdict.title}</p>
          <p className="text-muted-foreground">{verdict.detail}</p>
        </div>
      </div>

      {test.appliedVariant === "b" ? (
        <p className="text-sm text-muted-foreground">
          La variante B quedó en el borrador del bloque.{" "}
          <Link href={`/sitios/${siteId}/paginas/${test.pageId}/editor`} className="font-medium text-primary underline-offset-2 hover:underline">
            Abre el constructor y publica
          </Link>{" "}
          para que la vean todos.
        </p>
      ) : null}

      {test.appliedVariant === null ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button
            type="button"
            size="sm"
            variant={results.winner === "b" ? "primary" : "secondary"}
            loading={apply.isPending && apply.variables?.variant === "b"}
            onClick={() => apply.mutate({ testId: test.id, variant: "b" })}
          >
            Aplicar B al borrador
          </Button>
          <Button
            type="button"
            size="sm"
            variant={results.winner === "a" ? "primary" : "secondary"}
            loading={apply.isPending && apply.variables?.variant === "a"}
            onClick={() => apply.mutate({ testId: test.id, variant: "a" })}
          >
            Quedarme con A
          </Button>
          {running ? (
            <ConfirmButton size="sm" variant="ghost" confirmLabel="¿Terminar sin aplicar?" loading={stop.isPending} onConfirm={() => stop.mutate(test.id)}>
              Terminar sin aplicar
            </ConfirmButton>
          ) : null}
        </footer>
      ) : null}

      {error ? (
        <>
          <PlanLimitNotice error={error} />
          {abTestErrorMessage(error) ? (
            <p role="alert" className="text-sm text-danger">
              {abTestErrorMessage(error)}
            </p>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
