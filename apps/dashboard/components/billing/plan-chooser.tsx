"use client";

import type { BillingOverviewResponse, CheckoutRedirectResponse, PlanResponse } from "@impulza/contracts";
import { Button, Dialog, cn } from "@impulza/ui";
import { Check, Lock, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { billingErrorMessage, formatClp, formatDate, GATEWAY_OPTIONS, renewalDate, vatBreakdown, yearlySavings } from "../../lib/billing-text";
import { env } from "../../lib/env";
import { useStartCheckout } from "../../lib/hooks/use-billing";

type Cycle = "MONTHLY" | "YEARLY";

/** Lo que destaca cada plan en su tarjeta: los límites que más importan al elegir. */
function highlights(plan: PlanResponse): string[] {
  const n = (value: number | null, one: string, many: string) => (value === null ? `${many} sin límite` : `${value.toLocaleString("es-CL")} ${value === 1 ? one : many}`);
  return [
    n(plan.limits.sites, "sitio", "sitios"),
    n(plan.limits.pagesPerSite, "página por sitio", "páginas por sitio"),
    n(plan.limits.contacts, "contacto", "contactos"),
    n(plan.limits.members, "miembro del equipo", "miembros del equipo"),
    n(plan.limits.aiRequestsPerMonth, "solicitud de IA al mes", "solicitudes de IA al mes"),
  ];
}

/** Enlace externo para pedir un plan (F4.3, `NEXT_PUBLIC_PLAN_UPGRADE_URL`) cuando no hay pago en línea. */
function upgradeHref(code: string): string | null {
  const upgradeUrl = env.NEXT_PUBLIC_PLAN_UPGRADE_URL;
  if (!upgradeUrl) return null;
  if (upgradeUrl.startsWith("mailto:")) {
    return `${upgradeUrl}${upgradeUrl.includes("?") ? "&" : "?"}subject=${encodeURIComponent(`Cambio al plan ${code}`)}`;
  }
  const url = new URL(upgradeUrl);
  url.searchParams.set("plan", code);
  return url.toString();
}

/**
 * Elegir y contratar un plan (F4.6c). Tarjetas con el precio final (IVA incluido), el ahorro anual
 * y lo principal de cada plan; contratar abre el resumen con el desglose, la renovación automática
 * explícita y las dos aceptaciones legales (Ley 19.496) antes de ir a Webpay.
 */
export function PlanChooser({
  organizationId,
  plans,
  currentCode,
  billing,
}: {
  organizationId: string;
  plans: PlanResponse[];
  currentCode: string;
  billing: BillingOverviewResponse;
}): React.JSX.Element {
  const [cycle, setCycle] = useState<Cycle>("MONTHLY");
  const [selected, setSelected] = useState<PlanResponse | null>(null);
  const hasPaidPlan = billing.subscription !== null && billing.subscription.status !== "CANCELED";
  const canBuy = billing.canManage && billing.gateways.length > 0 && !hasPaidPlan;
  const bestSaving = Math.max(0, ...plans.map((plan) => yearlySavings(plan.priceMonthly, plan.priceYearly)?.months ?? 0));

  return (
    <section aria-labelledby="elegir-plan" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="elegir-plan" className="text-base font-semibold text-foreground">
            {hasPaidPlan ? "Planes disponibles" : "Elige el plan para tu negocio"}
          </h2>
          <p className="text-sm text-muted-foreground">Precios finales en pesos chilenos, IVA incluido. Cancela cuando quieras.</p>
        </div>
        <div role="radiogroup" aria-label="Forma de pago" className="inline-flex rounded-md border border-border bg-surface p-0.5">
          {(["MONTHLY", "YEARLY"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={cycle === key}
              onClick={() => setCycle(key)}
              className={cn(
                "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-200",
                cycle === key ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {key === "MONTHLY" ? "Mensual" : "Anual"}
              {key === "YEARLY" && bestSaving > 0 ? <span className="ml-1.5 text-xs font-semibold text-primary">−{bestSaving} meses</span> : null}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan, index) => {
          const price = cycle === "MONTHLY" ? plan.priceMonthly : plan.priceYearly;
          const saving = cycle === "YEARLY" ? yearlySavings(plan.priceMonthly, plan.priceYearly) : null;
          const isCurrent = plan.code === currentCode;
          const recommended = plan.code === "profesional";
          return (
            <li
              key={plan.code}
              className={cn(
                "motion-rise relative flex flex-col gap-4 rounded-lg border bg-background p-5 transition-[box-shadow,transform] duration-200 hover:shadow-md motion-safe:hover:-translate-y-0.5",
                recommended ? "border-primary shadow-sm" : "border-border",
                isCurrent && "bg-primary/5",
              )}
              style={{ animationDelay: `${index * 60}ms` }}
              data-testid={`plan-card-${plan.code}`}
            >
              {recommended ? (
                <span className="absolute -top-3 left-5 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                  <Sparkles className="size-3" aria-hidden="true" />
                  Recomendado
                </span>
              ) : null}
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
                <p className="flex items-baseline gap-1">
                  {/* `key` con el ciclo: el precio vuelve a entrar con la animación al cambiar de ciclo. */}
                  <span key={`${plan.code}-${cycle}`} className="motion-rise text-2xl font-semibold tabular-nums text-foreground">
                    {formatClp(price)}
                  </span>
                  <span className="text-sm text-muted-foreground">{price === 0 ? "para siempre" : cycle === "MONTHLY" ? "/mes" : "/año"}</span>
                </p>
                <p className="min-h-5 text-xs text-primary">
                  {saving ? `Ahorras ${formatClp(saving.amount)} (${saving.months} meses gratis)` : price === 0 ? "Sin tarjeta, sin plazo" : ""}
                </p>
              </div>
              <ul className="flex flex-1 flex-col gap-2 text-sm text-foreground">
                {highlights(plan).map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
              {isCurrent ? (
                <p className="inline-flex items-center justify-center gap-1 rounded-md border border-primary/30 py-2 text-sm font-medium text-primary">
                  <Check className="size-4" aria-hidden="true" />
                  Tu plan actual
                </p>
              ) : price > 0 && canBuy ? (
                <Button variant={recommended ? "primary" : "secondary"} onClick={() => setSelected(plan)}>
                  Elegir {plan.name}
                </Button>
              ) : price > 0 && billing.gateways.length === 0 && upgradeHref(plan.code) ? (
                // Sin pasarela configurada en este ambiente: el camino anterior (F4.3), pedirlo al equipo.
                <Button asChild variant="secondary">
                  <a href={upgradeHref(plan.code)!} target="_blank" rel="noopener noreferrer">
                    Solicitar {plan.name}
                  </a>
                </Button>
              ) : price > 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  {hasPaidPlan
                    ? "Para cambiar de plan, cancela el actual al terminar su período."
                    : !billing.canManage
                      ? "Solo el dueño de la organización puede contratar."
                      : "El pago en línea no está disponible en este momento."}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {selected ? (
        <CheckoutDialog
          organizationId={organizationId}
          plan={selected}
          cycle={cycle}
          gateways={billing.gateways}
          withdrawalDays={billing.legal.withdrawalDays}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}

/** Lleva el navegador a la pasarela: Oneclick exige un POST de formulario con el token. */
function goToGateway(redirect: CheckoutRedirectResponse): void {
  if (redirect.method === "GET") {
    window.location.assign(redirect.url);
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = redirect.url;
  for (const [name, value] of Object.entries(redirect.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

function CheckoutDialog({
  organizationId,
  plan,
  cycle,
  gateways,
  withdrawalDays,
  onClose,
}: {
  organizationId: string;
  plan: PlanResponse;
  cycle: Cycle;
  gateways: BillingOverviewResponse["gateways"];
  withdrawalDays: number;
  onClose: () => void;
}): React.JSX.Element {
  const checkout = useStartCheckout(organizationId);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptWithdrawal, setAcceptWithdrawal] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const termsId = useId();
  const withdrawalId = useId();
  const total = cycle === "MONTHLY" ? plan.priceMonthly : plan.priceYearly;
  const { net, vat } = vatBreakdown(total);
  const nextCharge = renewalDate(new Date(), cycle);
  const termsUrl = `${env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, "")}/terminos`;
  const [gateway, setGateway] = useState(gateways[0]!);
  const gatewayInfo = GATEWAY_OPTIONS[gateway];
  const gatewayGroupId = useId();
  const busy = checkout.isPending || redirecting;

  function pay() {
    checkout.mutate(
      { planCode: plan.code, cycle, gateway, acceptTerms: true, acceptWithdrawalNotice: true },
      {
        onSuccess: (redirect) => {
          setRedirecting(true);
          goToGateway(redirect);
        },
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}
      title={`Contratar el plan ${plan.name}`}
      description="Revisa el resumen antes de pagar."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Volver
          </Button>
          <Button onClick={pay} disabled={!acceptTerms || !acceptWithdrawal} loading={busy} data-testid="pay-button">
            <Lock className="size-4" aria-hidden="true" />
            {redirecting ? `Abriendo ${gatewayInfo.name}…` : `Pagar ${formatClp(total)} con ${gatewayInfo.name}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <dl className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="font-medium text-foreground">
              {plan.name} · {cycle === "MONTHLY" ? "mensual" : "anual"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Neto</dt>
            <dd className="tabular-nums text-foreground">{formatClp(net)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">IVA (19 %)</dt>
            <dd className="tabular-nums text-foreground">{formatClp(vat)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-base">
            <dt className="font-semibold text-foreground">Total hoy</dt>
            <dd className="font-semibold tabular-nums text-foreground" data-testid="checkout-total">
              {formatClp(total)}
            </dd>
          </div>
        </dl>

        <p className="text-sm text-foreground">
          Se renueva automáticamente el <strong>{formatDate(nextCharge)}</strong> por {formatClp(total)}, y así cada {cycle === "MONTHLY" ? "mes" : "año"}{" "}
          hasta que lo canceles desde esta misma pantalla, con un clic.
        </p>

        {gateways.length > 1 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">¿Cómo quieres pagar?</legend>
            {gateways.map((option) => (
              <label
                key={option}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors",
                  gateway === option ? "border-primary bg-primary/5" : "border-border hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name={gatewayGroupId}
                  value={option}
                  checked={gateway === option}
                  onChange={() => setGateway(option)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
                />
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{GATEWAY_OPTIONS[option].name}</span>
                  <span className="text-muted-foreground">{GATEWAY_OPTIONS[option].detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Aceptaciones</legend>
          <label htmlFor={termsId} className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
            <input
              id={termsId}
              type="checkbox"
              checked={acceptTerms}
              onChange={(event) => setAcceptTerms(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
            />
            <span>
              Acepto los{" "}
              <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2">
                Términos del servicio
              </a>
              , incluida la renovación automática.
            </span>
          </label>
          <label htmlFor={withdrawalId} className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
            <input
              id={withdrawalId}
              type="checkbox"
              checked={acceptWithdrawal}
              onChange={(event) => setAcceptWithdrawal(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
            />
            <span>
              Sé que tengo{" "}
              <a href={`${termsUrl}#retracto`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2">
                derecho a retracto
              </a>{" "}
              durante {withdrawalDays} días desde este pago, con reembolso total.
            </span>
          </label>
        </fieldset>

        {checkout.isError ? (
          <p role="alert" className="text-sm text-danger">
            {billingErrorMessage(checkout.error)}
          </p>
        ) : null}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {gatewayInfo.security}
        </p>
      </div>
    </Dialog>
  );
}
