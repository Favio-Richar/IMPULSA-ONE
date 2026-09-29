"use client";

import type { BlockResponse, SmartCtaResponse } from "@impulza/contracts";
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Input, LoadingState, Select } from "@impulza/ui";
import {
  isBlockType,
  isPrimaryActionBlockType,
  MAX_SMART_CTA_RULES,
  SMART_CTA_CONDITION_LABELS,
  SMART_CTA_DEVICES,
  smartCtaSchema,
  type SmartCtaConditionKind,
} from "@impulza/validation";
import { ArrowDown, ArrowUp, Info, Plus, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { BLOCK_LABELS } from "../../lib/block-fields/labels";
import { useBlocks } from "../../lib/hooks/use-blocks";
import { useSaveSmartCta, useSmartCta } from "../../lib/hooks/use-smart-cta";

const DEVICE_LABELS: Record<(typeof SMART_CTA_DEVICES)[number], string> = { mobile: "Teléfono", tablet: "Tablet", desktop: "Computador" };
const KIND_OPTIONS = (Object.keys(SMART_CTA_CONDITION_LABELS) as SmartCtaConditionKind[]).map((kind) => ({ value: kind, label: SMART_CTA_CONDITION_LABELS[kind] }));

/** Fila del editor: la condición en campos sueltos para el formulario. */
interface DraftRule {
  key: number;
  kind: SmartCtaConditionKind;
  device: (typeof SMART_CTA_DEVICES)[number];
  value: string;
  blockId: string;
}

function blockName(block: BlockResponse): string {
  const label = (block.config as { label?: unknown } | null)?.label;
  const type = isBlockType(block.type) ? BLOCK_LABELS[block.type] : block.type;
  return typeof label === "string" && label.trim() ? `${type}: ${label}` : type;
}

let nextKey = 1;

/**
 * Acción principal inteligente (Smart CTA, F6.6): reglas en orden que cambian cuál botón es el
 * principal según horario, dispositivo, campaña o disponibilidad de reservas. Gana la primera que
 * se cumple; si ninguna, queda la acción principal de siempre. Rige en vivo, sin publicar.
 */
export function SmartCtaCard({ organizationId, siteId, pageId }: { organizationId: string; siteId: string; pageId: string }): React.JSX.Element {
  const query = useSmartCta(organizationId, siteId, pageId);
  const blocksQuery = useBlocks(organizationId, siteId, pageId);
  const actionBlocks = (blocksQuery.data ?? []).filter((block) => isPrimaryActionBlockType(block.type)).sort((a, b) => a.position - b.position);

  return (
    <Card id="smart-cta" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="size-4 text-primary" aria-hidden="true" />
          Acción principal inteligente
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Cambia el botón principal según el momento: fuera de tu horario, en el teléfono o el computador, para una campaña, o cuando no
          quedan horas para reservar. Gana la primera regla que se cumple; si ninguna, queda tu botón principal de siempre. Rige de
          inmediato, sin publicar.
        </p>
        {query.isPending || blocksQuery.isPending ? (
          <LoadingState label="Cargando reglas…" />
        ) : query.isError || blocksQuery.isError ? (
          <ErrorState onRetry={() => void Promise.all([query.refetch(), blocksQuery.refetch()])} />
        ) : actionBlocks.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
            Esta página todavía no tiene botones de acción (WhatsApp, enlace, formulario o reservas).{" "}
            <Link href={`/sitios/${siteId}/paginas/${pageId}/editor`} className="font-medium text-primary underline-offset-2 hover:underline">
              Agrega uno en el constructor
            </Link>
            .
          </p>
        ) : (
          <SmartCtaEditor organizationId={organizationId} siteId={siteId} pageId={pageId} initial={query.data} actionBlocks={actionBlocks} />
        )}
      </CardContent>
    </Card>
  );
}

/** Editor de las reglas: arranca de lo guardado y solo envía al apretar «Guardar reglas». */
function SmartCtaEditor({
  organizationId,
  siteId,
  pageId,
  initial,
  actionBlocks,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  initial: SmartCtaResponse;
  actionBlocks: BlockResponse[];
}): React.JSX.Element {
  const save = useSaveSmartCta(organizationId, siteId, pageId);
  const [rules, setRules] = useState<DraftRule[]>(() =>
    initial.rules.map((rule) => {
      const condition = rule.condition as { kind: SmartCtaConditionKind; device?: DraftRule["device"]; value?: string };
      return { key: nextKey++, kind: condition.kind, device: condition.device ?? "mobile", value: condition.value ?? "", blockId: rule.blockId };
    }),
  );
  const [error, setError] = useState<string | null>(null);

  function change(next: DraftRule[]): void {
    setRules(next);
    // Un aviso viejo (p. ej. "elige qué botón") desaparece apenas se corrige algo.
    setError(null);
    save.reset();
  }

  function update(key: number, changes: Partial<DraftRule>): void {
    change(rules.map((rule) => (rule.key === key ? { ...rule, ...changes } : rule)));
  }

  function move(index: number, delta: number): void {
    const next = [...rules];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    change(next);
  }

  function submit(): void {
    setError(null);
    const payload = {
      rules: rules.map((rule) => ({
        blockId: rule.blockId,
        condition:
          rule.kind === "device"
            ? { kind: rule.kind, device: rule.device }
            : rule.kind === "utm_source" || rule.kind === "utm_campaign"
              ? { kind: rule.kind, value: rule.value }
              : { kind: rule.kind },
      })),
    };
    if (payload.rules.some((rule) => !rule.blockId)) {
      setError("Elige qué botón pasa a ser el principal en cada regla.");
      return;
    }
    const parsed = smartCtaSchema.safeParse(payload);
    if (!parsed.success) {
      setError("Escribe el valor de la fuente o campaña en cada regla que lo pide.");
      return;
    }
    save.mutate(parsed.data, {
      onError: (failure) => {
        const code = failure instanceof ApiError ? (failure.body as { code?: unknown } | undefined)?.code : undefined;
        setError(
          code === "SMART_CTA_BLOCK_INVALID"
            ? "Una regla apunta a un bloque que ya no es un botón de esta página."
            : failure instanceof ApiError && failure.status === 403
              ? "Tu rol no permite cambiar esta página."
              : "No pudimos guardar las reglas. Intenta de nuevo.",
        );
      },
    });
  }

  const usesHours = rules.some((rule) => rule.kind === "outside_hours");

  return (
    <>
      {rules.length === 0 ? <p className="text-sm text-muted-foreground">Sin reglas: siempre se muestra tu botón principal.</p> : null}
      <ol className="flex flex-col gap-3" aria-label="Reglas en orden">
        {rules.map((rule, index) => (
          <li key={rule.key} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">Regla {index + 1}</span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" aria-label={`Subir regla ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="size-4" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`Bajar regla ${index + 1}`} disabled={index === rules.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="size-4" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`Quitar regla ${index + 1}`} onClick={() => change(rules.filter((item) => item.key !== rule.key))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Select label="Cuando" options={KIND_OPTIONS} value={rule.kind} onChange={(event) => update(rule.key, { kind: event.target.value as SmartCtaConditionKind })} />
              {rule.kind === "device" ? (
                <Select
                  label="Dispositivo"
                  options={SMART_CTA_DEVICES.map((device) => ({ value: device, label: DEVICE_LABELS[device] }))}
                  value={rule.device}
                  onChange={(event) => update(rule.key, { device: event.target.value as DraftRule["device"] })}
                />
              ) : rule.kind === "utm_source" || rule.kind === "utm_campaign" ? (
                <Input
                  label={rule.kind === "utm_source" ? "Fuente (utm_source)" : "Campaña (utm_campaign)"}
                  placeholder={rule.kind === "utm_source" ? "instagram" : "black-friday"}
                  maxLength={80}
                  value={rule.value}
                  onChange={(event) => update(rule.key, { value: event.target.value })}
                />
              ) : (
                <div className="hidden md:block" aria-hidden="true" />
              )}
              <Select
                label="Botón principal"
                placeholder="Elige un botón"
                options={actionBlocks.map((block) => ({ value: block.id, label: blockName(block) }))}
                value={rule.blockId}
                onChange={(event) => update(rule.key, { blockId: event.target.value })}
              />
            </div>
          </li>
        ))}
      </ol>

      {usesHours && !initial.hoursConfigured ? (
        <p role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            «Fuera del horario» usa tu horario de atención, que todavía no configuraste.{" "}
            <Link href={`/sitios/${siteId}/reservas`} className="font-medium text-primary underline-offset-2 hover:underline">
              Configúralo en Reservas
            </Link>
            ; mientras tanto esa regla no se aplica.
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={rules.length >= MAX_SMART_CTA_RULES}
          onClick={() => change([...rules, { key: nextKey++, kind: "outside_hours", device: "mobile", value: "", blockId: "" }])}
        >
          <Plus className="size-4" aria-hidden="true" />
          Agregar regla
        </Button>
        <Button type="button" size="sm" loading={save.isPending} onClick={submit}>
          Guardar reglas
        </Button>
        {rules.length >= MAX_SMART_CTA_RULES ? <span className="text-sm text-muted-foreground">Máximo {MAX_SMART_CTA_RULES} reglas.</span> : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {save.isSuccess ? (
        <p role="status" className="text-sm text-success">
          Reglas guardadas. Ya rigen en tu página.
        </p>
      ) : null}
    </>
  );
}
