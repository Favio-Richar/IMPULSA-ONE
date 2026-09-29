"use client";

import type { PlanLimitsResponse, PlanResponse } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Info } from "lucide-react";
import { useState } from "react";
import { ReasonField, reasonError } from "../../../components/reason-field";
import { PageHeader, Section } from "../../../components/ui-bits";
import { ApiError } from "../../../lib/api-client";
import { adminApi } from "../../../lib/api";
import { formatPrice } from "../../../lib/format";

const LIMIT_FIELDS: Array<{ key: keyof PlanLimitsResponse; label: string; unit?: string; note?: string }> = [
  { key: "sites", label: "Sitios" },
  { key: "pagesPerSite", label: "Páginas por sitio" },
  { key: "forms", label: "Formularios" },
  { key: "contacts", label: "Contactos" },
  { key: "shortLinks", label: "Enlaces cortos" },
  { key: "qrCodes", label: "Códigos QR" },
  { key: "members", label: "Miembros" },
  { key: "analyticsHistoryDays", label: "Historial de analítica", unit: "días" },
  { key: "storageMb", label: "Almacenamiento", unit: "MB", note: "Aún no se aplica: no hay subida de archivos." },
  { key: "emailsPerHour", label: "Correos de campañas por hora" },
  { key: "aiRequestsPerMonth", label: "Solicitudes al asistente de IA por mes" },
  { key: "abTestsRunning", label: "Pruebas A/B en curso a la vez" },
];

export default function PlansPage(): React.JSX.Element {
  const plansQuery = useQuery({ queryKey: ["admin", "plans"], queryFn: adminApi.plans });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Planes"
        description="El catálogo que ven los clientes y que aplica el servidor. Bajar un límite nunca borra nada: solo impide crear más."
      />
      <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        Los valores iniciales son provisorios hasta cerrar la decisión #4 (límites y precios definitivos). Cada cambio queda auditado con el
        antes y el después.
      </p>

      {plansQuery.isPending ? (
        <LoadingState label="Cargando planes…" />
      ) : plansQuery.isError ? (
        <ErrorState onRetry={() => plansQuery.refetch()} />
      ) : plansQuery.data.length === 0 ? (
        <EmptyState title="No hay planes en el catálogo" description="Corre el seed de la base de datos para crear los planes iniciales." />
      ) : (
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          {plansQuery.data.map((plan) => (
            <PlanEditor key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}

type LimitDraft = { value: string; unlimited: boolean };

function PlanEditor({ plan }: { plan: PlanResponse }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState(plan.name);
  const [priceMonthly, setPriceMonthly] = useState(String(plan.priceMonthly));
  const [priceYearly, setPriceYearly] = useState(String(plan.priceYearly));
  const [currency, setCurrency] = useState(plan.currency);
  const [limits, setLimits] = useState<Record<keyof PlanLimitsResponse, LimitDraft>>(
    () =>
      Object.fromEntries(
        LIMIT_FIELDS.map(({ key }) => [key, { value: plan.limits[key] === null ? "" : String(plan.limits[key]), unlimited: plan.limits[key] === null }]),
      ) as Record<keyof PlanLimitsResponse, LimitDraft>,
  );
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  const isWholeNumber = (value: string) => /^\d+$/.test(value.trim());
  const errors = {
    name: name.trim().length < 2 ? "Al menos 2 caracteres." : undefined,
    priceMonthly: isWholeNumber(priceMonthly) ? undefined : "Un número entero, sin puntos ni decimales.",
    priceYearly: isWholeNumber(priceYearly) ? undefined : "Un número entero, sin puntos ni decimales.",
    currency: /^[A-Za-z]{3}$/.test(currency.trim()) ? undefined : "Código ISO de 3 letras, por ejemplo CLP.",
    reason: reasonError(reason),
    limits: Object.fromEntries(
      LIMIT_FIELDS.map(({ key }) => [key, limits[key].unlimited || isWholeNumber(limits[key].value) ? undefined : "Un entero ≥ 0, o marca Sin límite."]),
    ) as Record<keyof PlanLimitsResponse, string | undefined>,
  };
  const hasErrors =
    Boolean(errors.name || errors.priceMonthly || errors.priceYearly || errors.currency || errors.reason) ||
    Object.values(errors.limits).some(Boolean);

  const mutation = useMutation({
    mutationFn: () =>
      adminApi.updatePlan(plan.id, {
        name: name.trim(),
        priceMonthly: Number(priceMonthly),
        priceYearly: Number(priceYearly),
        currency: currency.trim().toUpperCase(),
        limits: Object.fromEntries(
          LIMIT_FIELDS.map(({ key }) => [key, limits[key].unlimited ? null : Number(limits[key].value)]),
        ) as PlanLimitsResponse,
        reason: reason.trim(),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<PlanResponse[]>(["admin", "plans"], (current) => current?.map((item) => (item.id === updated.id ? updated : item)));
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
      setReason("");
      setTouched(false);
      setSaved(true);
    },
  });

  const show = (error: string | undefined) => (touched ? error : undefined);

  return (
    <Section
      title={plan.name}
      description={`Código ${plan.code} · hoy ${formatPrice(plan.priceMonthly, plan.currency)}${plan.priceMonthly > 0 ? " al mes" : ""}`}
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          setSaved(false);
          if (!hasErrors) {
            mutation.mutate();
          }
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Nombre" value={name} onChange={(event) => setName(event.target.value)} error={show(errors.name)} maxLength={60} />
          <Input
            label="Moneda"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            error={show(errors.currency)}
            maxLength={3}
            helperText="ISO 4217 (CLP, USD…)."
          />
          <Input
            label="Precio mensual"
            inputMode="numeric"
            value={priceMonthly}
            onChange={(event) => setPriceMonthly(event.target.value)}
            error={show(errors.priceMonthly)}
            helperText={isWholeNumber(priceMonthly) ? `Se verá como ${formatPrice(Number(priceMonthly), currency.toUpperCase() || "CLP")}.` : undefined}
          />
          <Input
            label="Precio anual"
            inputMode="numeric"
            value={priceYearly}
            onChange={(event) => setPriceYearly(event.target.value)}
            error={show(errors.priceYearly)}
            helperText={isWholeNumber(priceYearly) ? `Se verá como ${formatPrice(Number(priceYearly), currency.toUpperCase() || "CLP")}.` : undefined}
          />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold text-foreground">Límites</legend>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {LIMIT_FIELDS.map(({ key, label, unit, note }) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Input
                  label={unit ? `${label} (${unit})` : label}
                  inputMode="numeric"
                  value={limits[key].unlimited ? "" : limits[key].value}
                  placeholder={limits[key].unlimited ? "Sin límite" : undefined}
                  disabled={limits[key].unlimited}
                  onChange={(event) => setLimits((current) => ({ ...current, [key]: { ...current[key], value: event.target.value } }))}
                  error={show(errors.limits[key])}
                  helperText={note}
                />
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-primary)]"
                    checked={limits[key].unlimited}
                    onChange={(event) => setLimits((current) => ({ ...current, [key]: { ...current[key], unlimited: event.target.checked } }))}
                  />
                  Sin límite
                </label>
              </div>
            ))}
          </div>
        </fieldset>

        <ReasonField value={reason} onChange={setReason} error={show(errors.reason)} />

        {mutation.isError ? (
          <p role="alert" className="text-sm text-danger">
            {mutation.error instanceof ApiError
              ? mutation.error.issues[0]
                ? `${mutation.error.issues[0].path}: ${mutation.error.issues[0].message}`
                : mutation.error.messageOr("No se pudo guardar el plan.")
              : "No se pudo guardar el plan."}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Plan guardado. Rige desde ya para todas las organizaciones que lo usan.
          </p>
        ) : null}

        <Button type="submit" loading={mutation.isPending} className="w-full sm:w-auto sm:self-start">
          Guardar cambios
        </Button>
      </form>
    </Section>
  );
}
