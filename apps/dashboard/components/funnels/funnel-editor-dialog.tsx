"use client";

import type { FunnelResponse } from "@impulza/contracts";
import {
  FUNNEL_MAX_EVENTS_PER_STEP,
  FUNNEL_MAX_STEPS,
  FUNNEL_MIN_STEPS,
  FUNNEL_STEP_EVENT_LABELS,
  FUNNEL_STEP_EVENTS,
  createFunnelSchema,
  type FunnelStep,
  type FunnelStepEvent,
} from "@impulza/validation";
import { Button, Dialog, Input, Select } from "@impulza/ui";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { BLOCK_LABELS } from "../../lib/block-fields/labels";
import { useBlocks } from "../../lib/hooks/use-blocks";
import { useSaveFunnel } from "../../lib/hooks/use-funnels";
import { usePages } from "../../lib/hooks/use-pages";

interface DraftStep {
  key: string;
  label: string;
  events: FunnelStepEvent[];
  subjectId: string | null;
  /** Página elegida para buscar el bloque de un paso "clic en bloque" (solo del editor). */
  blockPageId: string;
  /** Nombre del sujeto guardado, para mostrarlo al editar sin volver a elegirlo. */
  subjectLabel: string | null;
}

let nextKey = 0;
function draft(step: Partial<FunnelStep> & { subjectLabel?: string | null } = {}): DraftStep {
  nextKey += 1;
  return {
    key: `paso-${nextKey}`,
    label: step.label ?? "",
    events: step.events ?? [],
    subjectId: step.subjectId ?? null,
    blockPageId: "",
    subjectLabel: step.subjectLabel ?? null,
  };
}

/** Un paso admite página o bloque concreto solo con un único evento de vista o de clic. */
function subjectKind(step: DraftStep): "page" | "block" | null {
  if (step.events.length !== 1) {
    return null;
  }
  return step.events[0] === "page_view" ? "page" : step.events[0] === "block_click" ? "block" : null;
}

function serverMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return "Tu rol puede ver los embudos, pero no crearlos ni editarlos.";
    }
    const body = error.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string") {
      return body.message;
    }
  }
  return "No pudimos guardar el embudo. Intenta de nuevo.";
}

/**
 * Crear o editar un embudo (F7.6). Los pasos se ordenan con subir/bajar (operable con teclado, sin
 * arrastrar), cada uno con nombre, de 1 a 4 eventos y, si es una sola vista o un solo clic, una
 * página o un bloque del sitio. Se valida con el mismo esquema que la API antes de enviar; la API
 * vuelve a validar (y comprueba que la página o el bloque sean de este sitio).
 */
export function FunnelEditorDialog({
  organizationId,
  siteId,
  funnel,
  open,
  onOpenChange,
  onSaved,
}: {
  organizationId: string;
  siteId: string;
  /** `null` = crear uno nuevo. */
  funnel: FunnelResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (funnel: FunnelResponse) => void;
}) {
  const [name, setName] = useState(funnel?.name ?? "");
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    funnel ? funnel.steps.map((step) => draft(step)) : [draft({ label: "Visita", events: ["page_view"] }), draft()],
  );
  const [issues, setIssues] = useState<Record<string, string>>({});
  const save = useSaveFunnel(organizationId, siteId);
  const pagesQuery = usePages(organizationId, siteId);
  const pages = (pagesQuery.data ?? []).filter((page) => page.deletedAt === null);

  function updateStep(key: string, changes: Partial<DraftStep>): void {
    setSteps((current) =>
      current.map((step) => {
        if (step.key !== key) {
          return step;
        }
        const next = { ...step, ...changes };
        // Al cambiar los eventos, un sujeto que ya no aplica se descarta en vez de quedar oculto.
        return subjectKind(next) === subjectKind(step) ? next : { ...next, subjectId: null, blockPageId: "", subjectLabel: null };
      }),
    );
  }

  function move(index: number, delta: -1 | 1): void {
    setSteps((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function submit(): void {
    const candidate = {
      name,
      steps: steps.map((step) => ({ label: step.label, events: step.events, subjectId: step.subjectId })),
    };
    const parsed = createFunnelSchema.safeParse(candidate);
    if (!parsed.success) {
      setIssues(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])));
      return;
    }
    setIssues({});
    save.mutate(
      { funnelId: funnel?.id ?? null, input: parsed.data },
      {
        onSuccess: (saved) => onSaved(saved),
        onError: (error) => {
          const body = error instanceof ApiError ? (error.body as { issues?: Array<{ path: string; message: string }> } | undefined) : undefined;
          if (body?.issues) {
            setIssues(Object.fromEntries(body.issues.map((issue) => [issue.path, issue.message])));
          }
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={funnel ? `Editar «${funnel.name}»` : "Nuevo embudo"}
      description="Cada paso cuenta a las visitas que lo hicieron después del anterior, el mismo día."
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} loading={save.isPending}>
            {funnel ? "Guardar cambios" : "Crear embudo"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Input label="Nombre del embudo" value={name} maxLength={80} error={issues.name} onChange={(event) => setName(event.target.value)} />

        <ol className="flex flex-col gap-3" aria-label="Pasos">
          {steps.map((step, index) => (
            <li key={step.key} className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">Paso {index + 1}</span>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" aria-label={`Subir el paso ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Bajar el paso ${index + 1}`}
                    disabled={index === steps.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar el paso ${index + 1}`}
                    disabled={steps.length <= FUNNEL_MIN_STEPS}
                    onClick={() => setSteps((current) => current.filter((candidate) => candidate.key !== step.key))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <Input
                label={`Nombre del paso ${index + 1}`}
                value={step.label}
                maxLength={60}
                error={issues[`steps.${index}.label`]}
                onChange={(event) => updateStep(step.key, { label: event.target.value })}
              />
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-foreground">
                  Cuenta si la visita hizo… <span className="font-normal text-muted-foreground">(hasta {FUNNEL_MAX_EVENTS_PER_STEP})</span>
                </legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {FUNNEL_STEP_EVENTS.map((event) => {
                    const checked = step.events.includes(event);
                    const full = !checked && step.events.length >= FUNNEL_MAX_EVENTS_PER_STEP;
                    return (
                      <label key={event} className="flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--color-primary)]"
                          checked={checked}
                          disabled={full}
                          onChange={() =>
                            updateStep(step.key, { events: checked ? step.events.filter((value) => value !== event) : [...step.events, event] })
                          }
                        />
                        {FUNNEL_STEP_EVENT_LABELS[event]}
                      </label>
                    );
                  })}
                </div>
                {issues[`steps.${index}.events`] ? (
                  <p role="alert" className="mt-1 text-sm text-danger">
                    {issues[`steps.${index}.events`]}
                  </p>
                ) : null}
              </fieldset>
              {subjectKind(step) === "page" ? (
                <Select
                  label="Página (opcional)"
                  placeholder="Cualquier página"
                  value={step.subjectId ?? ""}
                  error={issues[`steps.${index}.subjectId`]}
                  options={pages.map((page) => ({ value: page.id, label: page.isHome ? "Inicio" : `/${page.slug}` }))}
                  onChange={(event) => updateStep(step.key, { subjectId: event.target.value || null })}
                />
              ) : null}
              {subjectKind(step) === "block" ? (
                <BlockSubjectPicker
                  organizationId={organizationId}
                  siteId={siteId}
                  pages={pages.map((page) => ({ id: page.id, label: page.isHome ? "Inicio" : `/${page.slug}` }))}
                  pageId={step.blockPageId}
                  blockId={step.subjectId}
                  error={issues[`steps.${index}.subjectId`]}
                  currentLabel={step.subjectLabel}
                  onPageChange={(pageId) => updateStep(step.key, { blockPageId: pageId, subjectId: null, subjectLabel: null })}
                  onBlockChange={(blockId) => updateStep(step.key, { subjectId: blockId })}
                />
              ) : null}
            </li>
          ))}
        </ol>

        {issues.steps ? (
          <p role="alert" className="text-sm text-danger">
            {issues.steps}
          </p>
        ) : null}
        {steps.length < FUNNEL_MAX_STEPS ? (
          <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setSteps((current) => [...current, draft()])}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar paso
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Un paso con una página o un bloque concreto cuenta las visitas desde que se activaron los embudos; los pasos generales
          usan todo el historial.
        </p>
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {serverMessage(save.error)}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function BlockSubjectPicker({
  organizationId,
  siteId,
  pages,
  pageId,
  blockId,
  error,
  currentLabel,
  onPageChange,
  onBlockChange,
}: {
  organizationId: string;
  siteId: string;
  pages: Array<{ id: string; label: string }>;
  pageId: string;
  blockId: string | null;
  error?: string;
  currentLabel: string | null;
  onPageChange: (pageId: string) => void;
  onBlockChange: (blockId: string | null) => void;
}) {
  if (blockId && !pageId) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface p-3 text-sm">
        <span className="text-foreground">
          Bloque: <span className="font-medium">{currentLabel ?? "un bloque que ya no existe"}</span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onBlockChange(null)}>
          Cambiar
        </Button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Select
        label="Página del bloque (opcional)"
        placeholder="Cualquier bloque"
        value={pageId}
        options={pages.map((page) => ({ value: page.id, label: page.label }))}
        onChange={(event) => onPageChange(event.target.value)}
      />
      {/* Solo con una página elegida se piden sus bloques. */}
      {pageId ? (
        <BlockSelect organizationId={organizationId} siteId={siteId} pageId={pageId} blockId={blockId} error={error} onChange={onBlockChange} />
      ) : null}
    </div>
  );
}

function BlockSelect({
  organizationId,
  siteId,
  pageId,
  blockId,
  error,
  onChange,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  blockId: string | null;
  error?: string;
  onChange: (blockId: string | null) => void;
}) {
  const blocksQuery = useBlocks(organizationId, siteId, pageId);
  const blocks = blocksQuery.data ?? [];

  return (
    <Select
      label="Bloque"
      placeholder={blocksQuery.isPending ? "Cargando bloques…" : blocksQuery.isError ? "No pudimos cargar los bloques" : "Cualquier bloque de esa página"}
      value={blockId ?? ""}
      error={error}
      options={blocks.map((block) => {
        const config = block.config as Record<string, unknown> | null;
        const own = ["label", "title", "name"].map((key) => config?.[key]).find((value) => typeof value === "string" && value.trim() !== "");
        const type = BLOCK_LABELS[block.type as keyof typeof BLOCK_LABELS] ?? block.type;
        return { value: block.id, label: own ? `${type}: ${String(own).slice(0, 50)}` : type };
      })}
      onChange={(event) => onChange(event.target.value || null)}
    />
  );
}
