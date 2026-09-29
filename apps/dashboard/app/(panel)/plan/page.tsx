"use client";

import type { OrganizationPlanResponse, PlanLimitsResponse, PlanResponse } from "@impulza/contracts";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@impulza/ui";
import { AlertTriangle, Check, CircleAlert } from "lucide-react";
import { useState } from "react";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { env } from "../../../lib/env";
import { useOrganizationPlan, usePlanCatalog } from "../../../lib/hooks/use-plans";

type UsageKey = keyof OrganizationPlanResponse["usage"];

const USAGE_ROWS: Array<{ key: UsageKey; label: string; hint?: string }> = [
  { key: "sites", label: "Sitios", hint: "Los archivados no cuentan." },
  { key: "forms", label: "Formularios" },
  { key: "contacts", label: "Contactos", hint: "Los que llegan por formulario se guardan siempre, aunque superes el límite." },
  { key: "shortLinks", label: "Enlaces cortos" },
  { key: "qrCodes", label: "Códigos QR" },
  { key: "members", label: "Miembros", hint: "Incluye invitaciones pendientes." },
  { key: "storageMb", label: "Almacenamiento (MB)", hint: "Fotos de tu biblioteca de medios, ya optimizadas." },
];

const COMPARATOR_ROWS: Array<{ key: keyof PlanLimitsResponse; label: string; unit?: string }> = [
  { key: "sites", label: "Sitios" },
  { key: "pagesPerSite", label: "Páginas por sitio" },
  { key: "forms", label: "Formularios" },
  { key: "contacts", label: "Contactos" },
  { key: "shortLinks", label: "Enlaces cortos" },
  { key: "qrCodes", label: "Códigos QR" },
  { key: "members", label: "Miembros" },
  { key: "analyticsHistoryDays", label: "Historial de analítica", unit: "días" },
  { key: "storageMb", label: "Almacenamiento de medios", unit: "MB" },
  { key: "emailsPerHour", label: "Correos de campañas por hora" },
  { key: "aiRequestsPerMonth", label: "Solicitudes al asistente de IA por mes" },
  { key: "abTestsRunning", label: "Pruebas A/B en curso a la vez" },
];

const SOURCE_LABELS: Record<OrganizationPlanResponse["source"], string> = {
  subscription: "Suscripción activa",
  assigned: "Asignado por el equipo de Impulza One",
  default: "Plan inicial",
};

const integer = new Intl.NumberFormat("es-CL");

function formatPrice(amount: number, currency: string): string {
  if (amount === 0) {
    return "Gratis";
  }
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function formatLimit(value: number | null, unit?: string): string {
  if (value === null) {
    return "Sin límite";
  }
  return unit ? `${integer.format(value)} ${unit}` : integer.format(value);
}

export default function PlanPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver su plan." />
    );
  }

  return <PlanOverview organizationId={activeOrganizationId} />;
}

function PlanOverview({ organizationId }: { organizationId: string }): React.JSX.Element {
  const planQuery = useOrganizationPlan(organizationId);
  const catalogQuery = usePlanCatalog();

  if (planQuery.isPending || catalogQuery.isPending) {
    return <LoadingState label="Cargando tu plan…" />;
  }
  if (planQuery.isError || catalogQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void planQuery.refetch();
          void catalogQuery.refetch();
        }}
      />
    );
  }

  const { plan, source, usage } = planQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Plan y uso</h1>
        <p className="text-sm text-muted-foreground">
          Lo que incluye tu plan y cuánto estás usando. Bajar de plan nunca borra nada: si algo
          queda por encima del nuevo límite, se conserva y solo no puedes crear más.
        </p>
      </div>

      <section aria-labelledby="plan-actual" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="plan-actual" className="text-base font-semibold text-foreground">
              Plan {plan.name}
            </h2>
            <p className="text-sm text-muted-foreground">{SOURCE_LABELS[source]}</p>
          </div>
          <p className="text-sm text-foreground">
            {plan.priceMonthly === 0 ? "Gratis" : `${formatPrice(plan.priceMonthly, plan.currency)} al mes`}
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {USAGE_ROWS.map((row) => (
            <UsageMeter key={row.key} label={row.label} hint={row.hint} used={usage[row.key]} max={plan.limits[row.key]} />
          ))}
        </ul>
      </section>

      <PlanComparator plans={catalogQuery.data} currentCode={plan.code} />
    </div>
  );
}

/**
 * Medidor de uso: el relleno lleva el estado (normal → cerca del límite → alcanzado) y el estado
 * además se escribe con ícono y texto — nunca solo con color (WCAG). El riel es un tono más claro
 * de la misma escala.
 */
function UsageMeter({
  label,
  hint,
  used,
  max,
}: {
  label: string;
  hint?: string;
  used: number;
  max: number | null;
}): React.JSX.Element {
  const ratio = max === null || max === 0 ? 0 : used / max;
  const state = max === null ? "unlimited" : used > max ? "over" : used >= max ? "full" : ratio >= 0.8 ? "near" : "ok";

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-foreground">
          {integer.format(used)} {max === null ? "" : `de ${integer.format(max)}`}
        </span>
      </div>
      {max === null ? (
        <p className="text-xs text-muted-foreground">Sin límite en tu plan.</p>
      ) : (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={Math.min(used, max)}
          aria-valuetext={`${used} de ${max}`}
          className={cn(
            "h-2 w-full rounded-sm",
            state === "over" || state === "full" ? "bg-danger/15" : state === "near" ? "bg-warning/15" : "bg-primary/15",
          )}
        >
          <div
            className={cn(
              "h-2 rounded-sm",
              state === "over" || state === "full" ? "bg-danger" : state === "near" ? "bg-warning" : "bg-primary",
            )}
            style={{ width: `${Math.min(Math.max(ratio * 100, used > 0 ? 3 : 0), 100)}%` }}
          />
        </div>
      )}
      {state === "full" || state === "over" ? (
        <p className="flex items-center gap-1 text-xs text-danger">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          {state === "over" ? "Por encima del límite: no puedes crear más." : "Límite alcanzado."}
        </p>
      ) : state === "near" ? (
        <p className="flex items-center gap-1 text-xs text-warning">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Cerca del límite.
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </li>
  );
}

function PlanComparator({ plans, currentCode }: { plans: PlanResponse[]; currentCode: string }): React.JSX.Element {
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const upgradeUrl = env.NEXT_PUBLIC_PLAN_UPGRADE_URL;

  function upgradeHref(code: string): string | null {
    if (!upgradeUrl) {
      return null;
    }
    if (upgradeUrl.startsWith("mailto:")) {
      const subject = encodeURIComponent(`Cambio al plan ${code}`);
      return `${upgradeUrl}${upgradeUrl.includes("?") ? "&" : "?"}subject=${subject}`;
    }
    const url = new URL(upgradeUrl);
    url.searchParams.set("plan", code);
    return url.toString();
  }

  return (
    <section aria-labelledby="comparador" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="comparador" className="text-base font-semibold text-foreground">
          Comparar planes
        </h2>
        <div role="radiogroup" aria-label="Forma de pago" className="inline-flex rounded-md border border-border p-0.5">
          {(["monthly", "yearly"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={billing === key}
              onClick={() => setBilling(key)}
              className={cn(
                "rounded-sm px-3 py-1 text-sm transition-colors",
                billing === key ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface",
              )}
            >
              {key === "monthly" ? "Mensual" : "Anual"}
            </button>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {/* Primera columna fija: en un teléfono la tabla se desplaza de lado y sin esto se pierde
                de vista qué fila es cuál. */}
            <TableHead className="sticky left-0 z-10 bg-surface">
              <span className="sr-only">Característica</span>
            </TableHead>
            {plans.map((plan) => (
              <TableHead key={plan.code} className={cn("text-center", plan.code === currentCode && "bg-primary/10")}>
                <span className="block text-foreground">{plan.name}</span>
                {plan.code === currentCode ? <span className="block text-xs font-normal normal-case text-primary">Tu plan</span> : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="sticky left-0 z-10 bg-background font-medium">Precio</TableCell>
            {plans.map((plan) => (
              <TableCell key={plan.code} className={cn("text-center tabular-nums", plan.code === currentCode && "bg-primary/5")}>
                {formatPrice(billing === "monthly" ? plan.priceMonthly : plan.priceYearly, plan.currency)}
                {(billing === "monthly" ? plan.priceMonthly : plan.priceYearly) > 0 ? (
                  <span className="block text-xs text-muted-foreground">{billing === "monthly" ? "al mes" : "al año"}</span>
                ) : null}
              </TableCell>
            ))}
          </TableRow>
          {COMPARATOR_ROWS.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="sticky left-0 z-10 bg-background">{row.label}</TableCell>
              {plans.map((plan) => (
                <TableCell key={plan.code} className={cn("text-center tabular-nums", plan.code === currentCode && "bg-primary/5")}>
                  {formatLimit(plan.limits[row.key], row.unit)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="sticky left-0 z-10 bg-background">
              <span className="sr-only">Acción</span>
            </TableCell>
            {plans.map((plan) => {
              const href = upgradeHref(plan.code);
              return (
                <TableCell key={plan.code} className={cn("text-center", plan.code === currentCode && "bg-primary/5")}>
                  {plan.code === currentCode ? (
                    <span className="inline-flex items-center gap-1 text-sm text-primary">
                      <Check className="size-4" aria-hidden="true" />
                      Actual
                    </span>
                  ) : href ? (
                    <Button asChild size="sm" variant="secondary">
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        Solicitar
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              );
            })}
          </TableRow>
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground">
        Precios en pesos chilenos, valores provisorios.{" "}
        {upgradeUrl
          ? "El pago en línea llega pronto: por ahora, el cambio de plan se solicita y lo activa el equipo de Impulza One."
          : "El pago en línea llega pronto. Por ahora, para cambiar de plan escríbele al equipo de Impulza One."}
      </p>
    </section>
  );
}
