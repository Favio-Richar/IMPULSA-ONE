"use client";

import type { AiBlockProposalsResponse, AiSeoProposalsResponse, AiStatusResponse } from "@impulza/contracts";
import { Button, Dialog, Input, Select, cn } from "@impulza/ui";
import {
  AI_TRANSLATION_LOCALES,
  AI_TRANSLATION_LOCALE_LABELS,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  type AiTranslationLocale,
} from "@impulza/validation";
import { ArrowRight, Languages, Search, ShieldCheck, Sparkles } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { aiErrorMessage, plainPreview } from "../../lib/ai-errors";
import { useAiStatus, useProposeBlockCopy, useProposeSeo, useTranslateBlock } from "../../lib/hooks/use-ai";
import { PlanLimitNotice } from "../plan-limit-notice";

// Asistente de textos (F6.3). Dos diálogos con el mismo recorrido: pedir → comparar lado a lado →
// aplicar con un clic explícito. La IA nunca guarda ni publica: "Aplicar" deja el cambio en el
// borrador (bloque) o en el formulario (SEO), y desde ahí se deshace o se descarta como cualquier otro.

const LOCALE_OPTIONS = AI_TRANSLATION_LOCALES.map((locale) => ({ value: locale, label: AI_TRANSLATION_LOCALE_LABELS[locale] }));

interface PageRef {
  organizationId: string;
  siteId: string;
  pageId: string;
}

// --- Textos de un bloque (reescribir o traducir) -----------------------------------------------------

export function BlockAiDialog({
  mode,
  open,
  onOpenChange,
  page,
  blockId,
  blockLabel,
  onApply,
}: {
  mode: "copy" | "translate";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: PageRef;
  blockId: string;
  blockLabel: string;
  /** Escribe los textos elegidos sobre la configuración vigente del bloque y la guarda como borrador. */
  onApply: (values: Record<string, string>) => Promise<void>;
}): React.JSX.Element {
  const copyMutation = useProposeBlockCopy(page.organizationId, page.siteId, page.pageId);
  const translateMutation = useTranslateBlock(page.organizationId, page.siteId, page.pageId);
  const mutation = mode === "copy" ? copyMutation : translateMutation;
  const status = useAiStatus(page.organizationId);
  const [instructions, setInstructions] = useState("");
  const [locale, setLocale] = useState<AiTranslationLocale>("en");
  const [selected, setSelected] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);

  const data: AiBlockProposalsResponse | undefined = mutation.data;
  const proposal = data?.proposals[Math.min(selected, (data?.proposals.length ?? 1) - 1)];

  function close(next: boolean): void {
    onOpenChange(next);
    if (!next) {
      copyMutation.reset();
      translateMutation.reset();
      setSelected(0);
      setApplyFailed(false);
    }
  }

  function generate(event: FormEvent): void {
    event.preventDefault();
    setSelected(0);
    setApplyFailed(false);
    if (mode === "copy") {
      copyMutation.mutate({ blockId, instructions: instructions.trim() || undefined });
    } else {
      translateMutation.mutate({ blockId, locale });
    }
  }

  async function apply(): Promise<void> {
    if (!proposal) {
      return;
    }
    setApplying(true);
    setApplyFailed(false);
    try {
      await onApply(proposal.values);
      close(false);
    } catch {
      setApplyFailed(true);
    } finally {
      setApplying(false);
    }
  }

  const isCopy = mode === "copy";

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={isCopy ? `Proponer textos · ${blockLabel}` : `Traducir · ${blockLabel}`}
      description={
        isCopy
          ? "La IA propone hasta tres versiones. Compara con lo actual y aplica la que prefieras."
          : "La IA traduce los textos visibles del bloque. Revisa la traducción antes de aplicarla."
      }
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void apply()} disabled={!proposal} loading={applying}>
            {isCopy ? "Aplicar propuesta" : "Aplicar traducción"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <form onSubmit={generate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            {isCopy ? (
              <Input
                label="Indicación (opcional)"
                placeholder="Ej.: más cercano, para una clínica dental"
                maxLength={300}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            ) : (
              <Select
                label="Traducir al"
                options={LOCALE_OPTIONS}
                value={locale}
                onChange={(event) => setLocale(event.target.value as AiTranslationLocale)}
              />
            )}
          </div>
          <Button type="submit" variant={data ? "secondary" : "primary"} loading={mutation.isPending} className="sm:w-auto">
            {isCopy ? <Sparkles className="size-4" aria-hidden="true" /> : <Languages className="size-4" aria-hidden="true" />}
            {data ? (isCopy ? "Generar otras" : "Traducir de nuevo") : isCopy ? "Generar propuestas" : "Traducir"}
          </Button>
        </form>

        <QuotaLine status={status.data} />

        <div aria-live="polite" className="flex flex-col gap-4">
          {mutation.isPending ? (
            <ProposalSkeleton label={isCopy ? "Escribiendo propuestas…" : "Traduciendo…"} rows={2} />
          ) : mutation.isError ? (
            <AiErrorNotice error={mutation.error} />
          ) : data && proposal ? (
            <>
              {data.proposals.length > 1 ? (
                <ProposalPicker count={data.proposals.length} selected={selected} onSelect={setSelected} />
              ) : null}
              <div className="flex flex-col gap-4">
                {data.fields.map((field) => (
                  <Comparison
                    key={field.key}
                    label={field.label}
                    current={field.rich ? plainPreview(data.current[field.key] ?? "") : (data.current[field.key] ?? "")}
                    proposed={field.rich ? plainPreview(proposal.values[field.key] ?? "") : (proposal.values[field.key] ?? "")}
                  />
                ))}
              </div>
              {applyFailed ? (
                <p role="alert" className="text-sm text-danger">
                  No pudimos aplicar la propuesta. Intenta de nuevo.
                </p>
              ) : null}
            </>
          ) : (
            <Intro icon={isCopy ? Sparkles : Languages}>
              {isCopy
                ? "Escribe una indicación si quieres un tono en particular, o genera directamente."
                : "Elige el idioma y traduce. Los nombres propios, enlaces y precios no cambian."}
            </Intro>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// --- SEO de la página ------------------------------------------------------------------------------

export function SeoAiDialog({
  open,
  onOpenChange,
  page,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: PageRef;
  /** Completa el formulario de SEO con la propuesta; el usuario revisa y guarda. */
  onApply: (proposal: { title: string; description: string }) => void;
}): React.JSX.Element {
  const mutation = useProposeSeo(page.organizationId, page.siteId, page.pageId);
  const status = useAiStatus(page.organizationId);
  const [instructions, setInstructions] = useState("");
  const [selected, setSelected] = useState(0);

  const data: AiSeoProposalsResponse | undefined = mutation.data;
  const proposal = data?.proposals[Math.min(selected, (data?.proposals.length ?? 1) - 1)];

  function close(next: boolean): void {
    onOpenChange(next);
    if (!next) {
      mutation.reset();
      setSelected(0);
    }
  }

  function generate(event: FormEvent): void {
    event.preventDefault();
    setSelected(0);
    mutation.mutate({ instructions: instructions.trim() || undefined });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title="Proponer SEO con IA"
      description="Título y descripción para buscadores a partir del contenido visible de tu página."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!proposal}
            onClick={() => {
              if (proposal) {
                onApply(proposal);
                close(false);
              }
            }}
          >
            Usar en el formulario
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <form onSubmit={generate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Input
              label="Indicación (opcional)"
              placeholder="Ej.: destacar que atiendo en Providencia"
              maxLength={300}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          <Button type="submit" variant={data ? "secondary" : "primary"} loading={mutation.isPending}>
            <Sparkles className="size-4" aria-hidden="true" />
            {data ? "Generar otras" : "Generar propuestas"}
          </Button>
        </form>

        <QuotaLine status={status.data} />

        <div aria-live="polite" className="flex flex-col gap-4">
          {mutation.isPending ? (
            <ProposalSkeleton label="Escribiendo propuestas…" rows={1} />
          ) : mutation.isError ? (
            <AiErrorNotice error={mutation.error} />
          ) : data && proposal ? (
            <>
              {data.proposals.length > 1 ? (
                <ProposalPicker count={data.proposals.length} selected={selected} onSelect={setSelected} />
              ) : null}
              <SearchPreview title={proposal.title} description={proposal.description} />
              <Comparison label="Título" current={data.current.title ?? ""} proposed={proposal.title} max={SEO_TITLE_MAX} />
              <Comparison label="Descripción" current={data.current.description ?? ""} proposed={proposal.description} max={SEO_DESCRIPTION_MAX} />
              <p className="text-sm text-muted-foreground">Se completa el formulario; revisa y guarda el SEO para que cuente.</p>
            </>
          ) : (
            <Intro icon={Search}>Genera propuestas y verás cómo quedaría tu página en los resultados de búsqueda.</Intro>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// --- piezas compartidas -----------------------------------------------------------------------------

function QuotaLine({ status }: { status: AiStatusResponse | undefined }): React.JSX.Element | null {
  if (!status) {
    return null;
  }
  const { limit, used } = status.quota;
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>
        Nada cambia hasta que apliques.{" "}
        {limit === null ? "Tu plan no tiene límite de solicitudes." : `Usaste ${used} de ${limit} solicitudes de IA este mes.`}
      </span>
    </p>
  );
}

function Intro({ icon: Icon, children }: { icon: typeof Sparkles; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border-strong bg-surface p-4 text-sm text-muted-foreground">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <p className="pt-1.5">{children}</p>
    </div>
  );
}

function ProposalSkeleton({ label, rows }: { label: string; rows: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4" role="status">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="size-4 animate-pulse text-primary" aria-hidden="true" />
        {label}
      </p>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
          <div className="h-16 animate-pulse rounded-md bg-surface" />
          <div className="h-16 animate-pulse rounded-md bg-primary/5" />
        </div>
      ))}
    </div>
  );
}

function AiErrorNotice({ error }: { error: unknown }): React.JSX.Element {
  const message = aiErrorMessage(error);
  return (
    <>
      <PlanLimitNotice error={error} />
      {message ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {message}
        </p>
      ) : null}
    </>
  );
}

/** Selector de propuesta: un grupo de opciones (flechas para moverse, como un grupo de radios). */
function ProposalPicker({ count, selected, onSelect }: { count: number; selected: number; onSelect: (index: number) => void }): React.JSX.Element {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-foreground">Propuestas</legend>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: count }, (_, index) => (
          <label
            key={index}
            className={cn(
              "flex h-9 cursor-pointer items-center justify-center rounded-md border text-sm font-medium transition-colors",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)] has-[:focus-visible]:ring-offset-2",
              index === selected ? "border-primary bg-primary text-primary-foreground shadow-xs" : "border-border-strong bg-background text-foreground hover:bg-surface",
            )}
          >
            <input type="radio" name={name} className="sr-only" checked={index === selected} onChange={() => onSelect(index)} />
            {index + 1}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Comparison({ label, current, proposed, max }: { label: string; current: string; proposed: string; max?: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual</span>
          <p className={cn("break-words text-sm", current ? "text-foreground" : "italic text-muted-foreground")}>{current || "Vacío"}</p>
        </div>
        <ArrowRight className="hidden size-4 self-center text-muted-foreground sm:block" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1 rounded-md border border-primary/40 bg-primary/5 p-3">
          <span className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-primary">
            Propuesta
            {max ? (
              <span className="font-normal normal-case tracking-normal text-muted-foreground tabular-nums">
                {proposed.length}/{max}
              </span>
            ) : null}
          </span>
          <p className="break-words text-sm text-foreground">{proposed}</p>
        </div>
      </div>
    </div>
  );
}

/** Cómo se vería en un buscador: título en color de enlace, descripción recortada como lo haría un buscador. */
function SearchPreview({ title, description }: { title: string; description: string }): React.JSX.Element {
  return (
    <figure className="flex flex-col gap-1 rounded-lg border border-border bg-background p-4 shadow-xs">
      <figcaption className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Search className="size-3.5" aria-hidden="true" />
        Vista en buscadores
      </figcaption>
      <p className="line-clamp-1 break-words text-lg leading-snug text-info">{title}</p>
      <p className="line-clamp-2 break-words text-sm text-muted-foreground">{description}</p>
    </figure>
  );
}
