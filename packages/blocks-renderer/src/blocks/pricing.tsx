import { Check } from "lucide-react";
import type { PricingBlockConfig, PricingPlan } from "@impulza/validation";
import { formatPrice } from "../lib/format-price.js";
import { LinkButton, type ButtonVariant } from "../ui/link-button.js";
import { stackSurfaceClass } from "../ui/stack-button.js";

const PERIOD_SUFFIX: Record<PricingPlan["period"], string> = { once: "", month: "/mes", year: "/año" };
const PERIOD_SPOKEN: Record<PricingPlan["period"], string> = { once: "pago único", month: "al mes", year: "al año" };

/**
 * Tabla de precios (F7.3): hasta 4 planes en tarjetas, uno bajo otro en la columna de la página y en
 * dos columnas si hay espacio. El plan destacado lleva el borde y el botón en el color primario; el
 * resto, el botón secundario. Montos enteros en la unidad mínima (ST §8), formateados con Intl.
 */
export function PricingBlock({ config, buttonVariant }: { config: PricingBlockConfig; buttonVariant: ButtonVariant }) {
  const glass = buttonVariant === "glass";
  const columns = config.plans.length > 1 ? "@md:grid-cols-2" : "";
  return (
    <section className="flex flex-col gap-3" aria-label={config.title ?? "Precios"}>
      {config.title ? <h2 className="text-center text-base font-semibold text-[var(--site-color-foreground)]">{config.title}</h2> : null}
      <ul className={`grid gap-3 ${columns}`}>
        {config.plans.map((plan, index) => (
          <li
            key={index}
            data-pricing-plan=""
            data-highlighted={plan.highlighted ? "" : undefined}
            className={`relative flex flex-col gap-4 p-5 ${stackSurfaceClass(glass ? "glass" : "secondary")} ${
              plan.highlighted ? "border-2 border-[var(--site-color-primary)]" : ""
            }`}
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-[var(--site-color-foreground)]">{plan.name}</h3>
                {plan.badge ? (
                  <span className="shrink-0 rounded-full bg-[var(--site-color-primary)] px-2.5 py-0.5 text-xs font-semibold text-[var(--site-color-primary-foreground)]">
                    {plan.badge}
                  </span>
                ) : null}
              </div>
              <p className="text-[var(--site-color-foreground)]">
                <span className="text-3xl font-bold tabular-nums">{formatPrice(plan.priceAmount, plan.priceCurrency)}</span>
                {PERIOD_SUFFIX[plan.period] ? (
                  <span className="text-sm text-[var(--site-color-muted-foreground)]">
                    <span aria-hidden="true">{PERIOD_SUFFIX[plan.period]}</span>
                    <span className="sr-only"> {PERIOD_SPOKEN[plan.period]}</span>
                  </span>
                ) : (
                  <span className="sr-only"> {PERIOD_SPOKEN.once}</span>
                )}
              </p>
              {plan.description ? <p className="text-sm text-[var(--site-color-muted-foreground)]">{plan.description}</p> : null}
            </div>
            {plan.features.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm text-[var(--site-color-foreground)]">
                {plan.features.map((feature, featureIndex) => (
                  <li key={featureIndex} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--site-color-link)]" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {plan.cta ? (
              <div className="mt-auto flex">
                <LinkButton href={plan.cta.url} block variant={glass ? "glass" : plan.highlighted ? "primary" : "secondary"}>
                  {plan.cta.label}
                </LinkButton>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
