"use client";

import type { OrganizationPlanResponse, PlanLimitsResponse, PlanResponse } from "@impulza/contracts";
import { EmptyState, ErrorState, LoadingState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@impulza/ui";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PaymentHistory } from "../../../components/billing/payment-history";
import { PaymentResultBanner } from "../../../components/billing/payment-result-banner";
import { PlanChooser } from "../../../components/billing/plan-chooser";
import { SubscriptionCard } from "../../../components/billing/subscription-card";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { parsePaymentOutcome } from "../../../lib/billing-text";
import { useBilling } from "../../../lib/hooks/use-billing";
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
  { key: "clients", label: "Clientes del modo agencia (0 = no incluido)" },
];

const SOURCE_LABELS: Record<OrganizationPlanResponse["source"], string> = {
  subscription: "Suscripción activa",
  assigned: "Asignado por el equipo de Impulza One",
  default: "Plan inicial",
};

const integer = new Intl.NumberFormat("es-CL");

function formatLimit(value: number | null, unit?: string): string {
  if (value === null) {
    return "Sin límite";
  }
  return unit ? `${integer.format(value)} ${unit}` : integer.format(value);
}

export default function PlanPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver su plan." />;
  }

  // `useSearchParams` (el resultado de Webpay) exige un límite de Suspense en el App Router.
  return (
    <Suspense fallback={<LoadingState label="Cargando tu plan…" />}>
      <PlanOverview organizationId={activeOrganizationId} />
    </Suspense>
  );
}

function PlanOverview({ organizationId }: { organizationId: string }): React.JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const outcome = parsePaymentOutcome(searchParams.get("pago"));

  const planQuery = useOrganizationPlan(organizationId);
  const catalogQuery = usePlanCatalog();
  const billingQuery = useBilling(organizationId, { pollWhilePending: outcome === "pendiente" });

  if (planQuery.isPending || catalogQuery.isPending || billingQuery.isPending) {
    return <LoadingState label="Cargando tu plan…" />;
  }
  if (planQuery.isError || catalogQuery.isError || billingQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void planQuery.refetch();
          void catalogQuery.refetch();
          void billingQuery.refetch();
        }}
      />
    );
  }

  const { plan, source, usage } = planQuery.data;
  const billing = billingQuery.data;
  const plans = [...catalogQuery.data].sort((a, b) => a.sortOrder - b.sortOrder);
  // "Agencia" no se contrata en línea hasta definir el modo agencia (decisión #8).
  const purchasable = plans.filter((item) => item.code !== "agencia");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Plan y pagos</h1>
        <p className="text-sm text-muted-foreground">
          Lo que incluye tu plan, cuánto estás usando y tus pagos. Cambiar o terminar un plan nunca borra nada: si algo queda por encima del límite, se
          conserva y solo no puedes crear más.
        </p>
      </div>

      {outcome ? <PaymentResultBanner outcome={outcome} onDismiss={() => router.replace(pathname)} /> : null}

      {billing.subscription ? <SubscriptionCard organizationId={organizationId} subscription={billing.subscription} canManage={billing.canManage} /> : null}

      <section aria-labelledby="plan-actual" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="plan-actual" className="text-base font-semibold text-foreground">
              Uso del plan {plan.name}
            </h2>
            <p className="text-sm text-muted-foreground">{SOURCE_LABELS[source]}</p>
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {USAGE_ROWS.map((row) => (
            <UsageMeter key={row.key} label={row.label} hint={row.hint} used={usage[row.key]} max={plan.limits[row.key]} />
          ))}
        </ul>
      </section>

      <PlanChooser organizationId={organizationId} plans={purchasable} currentCode={plan.code} billing={billing} />

      <details className="group rounded-lg border border-border bg-background">
        <summary className="cursor-pointer select-none rounded-lg px-5 py-3 text-sm font-medium text-foreground hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
          Ver la comparación completa de planes
        </summary>
        <div className="border-t border-border p-4">
          <PlanComparator plans={plans} currentCode={plan.code} />
        </div>
      </details>

      <PaymentHistory payments={billing.payments} />
    </div>
  );
}

/**
 * Medidor de uso: el relleno lleva el estado (normal → cerca del límite → alcanzado) y el estado
 * además se escribe con ícono y texto — nunca solo con color (WCAG). El riel es un tono más claro
 * de la misma escala.
 */
function UsageMeter({ label, hint, used, max }: { label: string; hint?: string; used: number; max: number | null }): React.JSX.Element {
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
          className={cn("h-2 w-full rounded-sm", state === "over" || state === "full" ? "bg-danger/15" : state === "near" ? "bg-warning/15" : "bg-primary/15")}
        >
          <div
            className={cn(
              "h-2 rounded-sm transition-[width] duration-500 ease-out",
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
  return (
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
      </TableBody>
    </Table>
  );
}
