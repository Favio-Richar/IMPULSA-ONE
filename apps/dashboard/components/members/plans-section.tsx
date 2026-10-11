"use client";

import type { MembershipPlanResponse } from "@impulza/contracts";
import { MEMBERSHIP_PERIOD_LABELS, MEMBERSHIP_PLAN_NAME_MAX } from "@impulza/validation";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { createMembershipPlan, listMembershipPlans, setMembershipPlanStatus, updateMembershipPlan } from "../../lib/api/memberships";

const money = (amount: number, currency: string): string =>
  currency === "CLP" ? new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount) : `${amount} ${currency}`;

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

/** Planes de membresía del sitio, lo cobrado en el mes y si el cobro en línea está disponible (F10.2). */
export function PlansSection({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const key = ["membership-plans", organizationId, siteId];
  const query = useQuery({ queryKey: key, queryFn: () => listMembershipPlans(organizationId, siteId) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["site-members", organizationId, siteId] });
  };

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [period, setPeriod] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [invalid, setInvalid] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createMembershipPlan(organizationId, siteId, {
        name: name.trim(),
        description: description.trim() || undefined,
        priceAmount: Number(price),
        priceCurrency: "CLP",
        period,
      }),
    onSuccess: () => {
      setName("");
      setDescription("");
      setPrice("");
      refresh();
    },
  });
  const archive = useMutation({
    mutationFn: (input: { plan: MembershipPlanResponse; action: "archive" | "restore" }) => setMembershipPlanStatus(organizationId, siteId, input.plan.id, input.action),
    onSuccess: refresh,
  });

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (name.trim().length < 2) return setInvalid("Ponle un nombre al plan.");
    if (!/^\d+$/.test(price.trim()) || Number(price) < 1) return setInvalid("Escribe el precio en pesos, sin puntos ni decimales.");
    setInvalid(null);
    create.mutate();
  }

  return (
    <section aria-labelledby="planes" className="flex flex-col gap-4">
      <div>
        <h2 id="planes" className="text-lg font-semibold text-foreground">
          Planes de membresía
        </h2>
        <p className="text-sm text-muted-foreground">
          Cada plan se paga por un periodo (mensual o anual) y no se renueva solo: quien compra puede renovar cuando quiera y los días se suman. El dinero va directo a tu cuenta
          de Mercado Pago.
        </p>
      </div>

      {query.isPending ? (
        <LoadingState label="Cargando planes…" />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : (
        <>
          {!query.data.checkoutAvailable ? (
            <p role="status" className="rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
              Todavía no puedes vender membresías: conecta tu cuenta de Mercado Pago en{" "}
              <Link href="/cobros" className="text-primary underline underline-offset-2">
                Cobros
              </Link>
              . Hasta entonces, los planes no se muestran a tus visitantes.
            </p>
          ) : null}

          {query.data.monthRevenue.length > 0 ? (
            <p className="text-sm text-foreground">
              Cobrado este mes:{" "}
              {query.data.monthRevenue.map((row) => `${money(row.amount, row.currency)} (${row.purchases} ${row.purchases === 1 ? "compra" : "compras"})`).join(" · ")}
            </p>
          ) : null}

          {query.data.plans.length === 0 ? (
            <EmptyState title="Todavía no tienes planes" description="Crea el primero con el formulario de abajo." />
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
              {query.data.plans.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  organizationId={organizationId}
                  siteId={siteId}
                  onChanged={refresh}
                  onToggle={(action) => archive.mutate({ plan, action })}
                />
              ))}
            </ul>
          )}
          {archive.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorText(archive.error, "No pudimos cambiar el plan. Intenta de nuevo.")}
            </p>
          ) : null}
        </>
      )}

      <form noValidate onSubmit={submit} aria-label="Crear plan" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Nombre del plan" value={name} maxLength={MEMBERSHIP_PLAN_NAME_MAX} onChange={(event) => setName(event.target.value)} required />
          <Input label="Precio (CLP)" inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} required />
        </div>
        <Input label="Descripción (opcional)" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} />
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Se cobra
          <select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} className="min-h-10 rounded-md border border-border bg-background px-2 text-sm">
            <option value="MONTHLY">Cada mes (30 días)</option>
            <option value="YEARLY">Cada año (365 días)</option>
          </select>
        </label>
        {invalid ? (
          <p role="alert" className="text-sm text-danger">
            {invalid}
          </p>
        ) : null}
        {create.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorText(create.error, "No pudimos crear el plan. Intenta de nuevo.")}
          </p>
        ) : null}
        <div>
          <Button type="submit" loading={create.isPending}>
            Crear plan
          </Button>
        </div>
      </form>
    </section>
  );
}

function PlanRow({
  plan,
  organizationId,
  siteId,
  onChanged,
  onToggle,
}: {
  plan: MembershipPlanResponse;
  organizationId: string;
  siteId: string;
  onChanged: () => void;
  onToggle: (action: "archive" | "restore") => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(plan.priceAmount));
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => updateMembershipPlan(organizationId, siteId, plan.id, { priceAmount: Number(price) }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{plan.name}</span>
          <span className="text-xs text-muted-foreground">
            {money(plan.priceAmount, plan.priceCurrency)} {MEMBERSHIP_PERIOD_LABELS[plan.period]} · {plan.activeMembers} {plan.activeMembers === 1 ? "miembro vigente" : "miembros vigentes"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              plan.status === "ACTIVE"
                ? "rounded-sm border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary"
                : "rounded-sm border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted-foreground"
            }
          >
            {plan.status === "ACTIVE" ? "A la venta" : "Archivado"}
          </span>
          <Button variant="ghost" size="sm" aria-label={`Cambiar el precio de ${plan.name}`} onClick={() => setEditing((value) => !value)}>
            Cambiar precio
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onToggle(plan.status === "ACTIVE" ? "archive" : "restore")}>
            {plan.status === "ACTIVE" ? "Archivar" : "Volver a vender"}
          </Button>
        </div>
      </div>
      {editing ? (
        <form
          noValidate
          aria-label={`Precio de ${plan.name}`}
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!/^\d+$/.test(price.trim()) || Number(price) < 1) return setInvalid("Escribe el precio en pesos, sin puntos ni decimales.");
            setInvalid(null);
            save.mutate();
          }}
        >
          <Input label="Nuevo precio" inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} error={invalid ?? undefined} />
          <Button type="submit" size="sm" loading={save.isPending}>
            Guardar
          </Button>
          <p className="basis-full text-xs text-muted-foreground">Solo afecta compras nuevas: quien ya pagó conserva su periodo.</p>
          {save.isError ? (
            <p role="alert" className="basis-full text-sm text-danger">
              {errorText(save.error, "No pudimos guardar el precio.")}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}
