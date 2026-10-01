"use client";

import type { CouponResponse } from "@impulza/contracts";
import { Button, Dialog, Input, Select } from "@impulza/ui";
import { couponRulesProblem, createCouponSchema, updateCouponSchema, type CouponKind } from "@impulza/validation";
import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api-client";
import { useSaveCoupon } from "../../lib/hooks/use-coupons";
import { moneyToInput, parseMoneyInput } from "../../lib/money-input";
import { isoToLocalInput, localInputToIso } from "../../lib/page-campaign-messages";

const CURRENCIES = ["CLP", "USD", "ARS", "PEN", "COP", "MXN", "UYU", "EUR"];

interface Draft {
  code: string;
  description: string;
  kind: CouponKind;
  percent: string;
  amount: string;
  currency: string;
  minSubtotal: string;
  startsAt: string;
  endsAt: string;
  maxRedemptions: string;
  active: boolean;
}

type Field = keyof Draft;

function initialDraft(coupon: CouponResponse | null): Draft {
  const currency = coupon?.currency ?? "";
  return {
    code: coupon?.code ?? "",
    description: coupon?.description ?? "",
    kind: coupon?.kind ?? "percent",
    percent: coupon?.percentOff === null || coupon?.percentOff === undefined ? "" : String(coupon.percentOff),
    amount: coupon?.amountOff === null || coupon?.amountOff === undefined ? "" : moneyToInput(coupon.amountOff, currency || "CLP"),
    // Un porcentaje nuevo vale en cualquier moneda; el monto fijo (o un mínimo) pide elegirla.
    currency: coupon ? currency : "",
    minSubtotal: coupon?.minSubtotal === null || coupon?.minSubtotal === undefined ? "" : moneyToInput(coupon.minSubtotal, currency || "CLP"),
    startsAt: coupon?.startsAt ? isoToLocalInput(coupon.startsAt) : "",
    endsAt: coupon?.endsAt ? isoToLocalInput(coupon.endsAt) : "",
    maxRedemptions: coupon?.maxRedemptions === null || coupon?.maxRedemptions === undefined ? "" : String(coupon.maxRedemptions),
    active: coupon?.active ?? true,
  };
}

/** Lo escrito → campos de la API (montos en la unidad mínima, fechas en ISO). */
function toValues(draft: Draft): { values?: Record<string, unknown>; errors?: Partial<Record<Field, string>> } {
  const errors: Partial<Record<Field, string>> = {};
  const currency = draft.currency || null;
  const percent = draft.percent.trim() === "" ? null : Number(draft.percent);
  if (draft.kind === "percent" && (percent === null || !Number.isInteger(percent))) errors.percent = "Escribe un porcentaje entero de 1 a 100.";
  const amount = parseMoneyInput(draft.amount, currency ?? "CLP");
  if (draft.kind === "fixed" && (amount === null || amount === "invalid")) errors.amount = "Escribe el monto del descuento.";
  const minSubtotal = parseMoneyInput(draft.minSubtotal, currency ?? "CLP");
  if (minSubtotal === "invalid") errors.minSubtotal = "La compra mínima tiene que ser un monto.";
  const maxText = draft.maxRedemptions.trim();
  const maxRedemptions = maxText === "" ? null : Number(maxText);
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) errors.maxRedemptions = "Un número entero desde 1 (o vacío, sin tope).";
  const startsAt = draft.startsAt ? localInputToIso(draft.startsAt) : null;
  const endsAt = draft.endsAt ? localInputToIso(draft.endsAt) : null;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    values: {
      code: draft.code,
      description: draft.description.trim() === "" ? null : draft.description.trim(),
      kind: draft.kind,
      percentOff: draft.kind === "percent" ? percent : null,
      amountOff: draft.kind === "fixed" ? amount : null,
      currency,
      minSubtotal: minSubtotal === "invalid" ? null : minSubtotal,
      startsAt,
      endsAt,
      maxRedemptions,
      active: draft.active,
    },
  };
}

/** Campo del formulario al que apunta un error de las reglas (la API y el esquema usan los nombres de la API). */
const FIELD_OF: Record<string, Field> = { percentOff: "percent", amountOff: "amount", currency: "currency", minSubtotal: "minSubtotal", endsAt: "endsAt", code: "code", maxRedemptions: "maxRedemptions" };

function withoutNulls(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null));
}

/**
 * Crear o editar un cupón (F7.8b, ADR-023). Valida con los mismos esquemas y reglas que la API;
 * la API es la autoridad (código único, tope bajo los usos) y su mensaje se muestra en el campo.
 */
export function CouponEditorDialog({
  open,
  onOpenChange,
  organizationId,
  siteId,
  coupon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  siteId: string;
  coupon: CouponResponse | null;
}): React.JSX.Element {
  const save = useSaveCoupon(organizationId, siteId);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(coupon));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const formId = coupon ? `cupon-${coupon.id}` : "cupon-nuevo";
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  function close(next: boolean): void {
    onOpenChange(next);
    if (!next) save.reset();
  }

  function applyIssues(issues: Array<{ path: PropertyKey[] | string; message: string }>): void {
    const next: Partial<Record<Field, string>> = {};
    for (const issue of issues) {
      const key = Array.isArray(issue.path) ? String(issue.path[0] ?? "") : issue.path;
      const field = FIELD_OF[key];
      if (field) next[field] ??= issue.message;
      else setFormError(issue.message);
    }
    setErrors(next);
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    const { values, errors: problems } = toValues(draft);
    if (!values) {
      setErrors(problems ?? {});
      return;
    }
    if (coupon === null) {
      const parsed = createCouponSchema.safeParse(withoutNulls(values));
      if (!parsed.success) return applyIssues(parsed.error.issues);
      save.mutate({ couponId: null, body: parsed.data }, { onSuccess: () => close(false), onError: (error) => showServerError(error) });
      return;
    }
    const parsed = updateCouponSchema.safeParse(values);
    if (!parsed.success) return applyIssues(parsed.error.issues);
    const problem = couponRulesProblem({
      kind: draft.kind,
      percentOff: values.percentOff as number | null,
      amountOff: values.amountOff as number | null,
      currency: values.currency as string | null,
      minSubtotal: values.minSubtotal as number | null,
      startsAt: values.startsAt as string | null,
      endsAt: values.endsAt as string | null,
      maxRedemptions: values.maxRedemptions as number | null,
    });
    if (problem) return applyIssues([{ path: problem.path, message: problem.message }]);
    save.mutate({ couponId: coupon.id, body: parsed.data }, { onSuccess: () => close(false), onError: (error) => showServerError(error) });
  }

  function showServerError(error: unknown): void {
    if (error instanceof ApiError) {
      const body = error.body as { message?: unknown; issues?: Array<{ path: string; message: string }> } | undefined;
      if (error.status === 409) return setErrors({ code: typeof body?.message === "string" ? body.message : "Ese código ya existe." });
      if (body?.issues && body.issues.length > 0) return applyIssues(body.issues);
      if (error.status === 403) return setFormError("Tu rol no permite cambiar los cupones.");
      if (typeof body?.message === "string") return setFormError(body.message);
    }
    setFormError("No se pudo guardar. Intenta de nuevo.");
  }

  const currencyOptions = [
    ...(draft.kind === "percent" ? [{ value: "", label: "Cualquiera" }] : []),
    ...CURRENCIES.map((code) => ({ value: code, label: code })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={coupon ? `Editar ${coupon.code}` : "Nuevo cupón"}
      description="Un código que tus clientes escriben al pedir. El descuento lo calcula el sistema, nunca el navegador."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {coupon ? "Guardar cambios" : "Crear cupón"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Código"
            required
            maxLength={30}
            value={draft.code}
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
            placeholder="CYBER15"
            helperText="Letras, números y guiones, sin espacios."
            error={errors.code}
          />
          <Input
            label="Nota interna (opcional)"
            maxLength={120}
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
            placeholder="Para la campaña de Instagram"
            helperText="Solo la ves tú."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Tipo de descuento"
            options={[
              { value: "percent", label: "Porcentaje" },
              { value: "fixed", label: "Monto fijo" },
            ]}
            value={draft.kind}
            onChange={(event) => {
              const kind = event.target.value as CouponKind;
              set({ kind, ...(kind === "fixed" && draft.currency === "" ? { currency: "CLP" } : {}) });
            }}
          />
          {draft.kind === "percent" ? (
            <Input label="Porcentaje" inputMode="numeric" required value={draft.percent} onChange={(event) => set({ percent: event.target.value })} placeholder="15" error={errors.percent} />
          ) : (
            <Input label="Monto" inputMode="decimal" required value={draft.amount} onChange={(event) => set({ amount: event.target.value })} placeholder="5.000" error={errors.amount} />
          )}
          <Select
            label="Moneda"
            options={currencyOptions}
            value={draft.currency}
            onChange={(event) => set({ currency: event.target.value })}
            helperText={draft.kind === "percent" ? "«Cualquiera»: vale en todos tus precios." : undefined}
            error={errors.currency}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Compra mínima (opcional)"
            inputMode="decimal"
            value={draft.minSubtotal}
            onChange={(event) => set({ minSubtotal: event.target.value })}
            placeholder="Sin mínimo"
            helperText="Antes del descuento. Pide elegir la moneda."
            error={errors.minSubtotal}
          />
          <Input
            label="Máximo de usos (opcional)"
            inputMode="numeric"
            value={draft.maxRedemptions}
            onChange={(event) => set({ maxRedemptions: event.target.value })}
            placeholder="Sin tope"
            helperText="Cada pedido con el código cuenta un uso."
            error={errors.maxRedemptions}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Desde (opcional)" type="datetime-local" value={draft.startsAt} onChange={(event) => set({ startsAt: event.target.value })} error={errors.startsAt} />
          <Input
            label="Hasta (opcional)"
            type="datetime-local"
            value={draft.endsAt}
            onChange={(event) => set({ endsAt: event.target.value })}
            helperText="Hora de tu dispositivo."
            error={errors.endsAt}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={draft.active} onChange={(event) => set({ active: event.target.checked })} />
          Activo (se puede usar ya)
        </label>

        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
