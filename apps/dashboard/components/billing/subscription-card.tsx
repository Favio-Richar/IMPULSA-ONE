"use client";

import type { BillingSubscriptionResponse } from "@impulza/contracts";
import { Button, cn } from "@impulza/ui";
import { CreditCard, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { billingErrorMessage, formatClp, formatDate, subscriptionStatusLabel } from "../../lib/billing-text";
import { useCancelSubscription, useResumeSubscription, useWithdrawSubscription } from "../../lib/hooks/use-billing";
import { ConfirmButton } from "../confirm-button";

const BADGE = {
  success: "bg-success/5 text-success ring-1 ring-inset ring-success/25",
  warning: "bg-warning/5 text-warning ring-1 ring-inset ring-warning/25",
  danger: "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25",
  neutral: "bg-surface text-muted-foreground",
} as const;

/**
 * La suscripción de pago: estado, próximo cobro, tarjeta y las acciones que exige la ley — cancelar
 * con un clic (mismo medio en que se contrató) y el retracto con reembolso en los primeros 10 días.
 * Las acciones solo se muestran a quien puede hacerlas (`canManage`, lo decide el servidor).
 */
export function SubscriptionCard({
  organizationId,
  subscription,
  canManage,
}: {
  organizationId: string;
  subscription: BillingSubscriptionResponse;
  canManage: boolean;
}): React.JSX.Element {
  const cancel = useCancelSubscription(organizationId);
  const resume = useResumeSubscription(organizationId);
  const withdraw = useWithdrawSubscription(organizationId);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const status = subscriptionStatusLabel(subscription);
  const ended = subscription.status === "CANCELED";
  const cycleLabel = subscription.cycle === "MONTHLY" ? "al mes" : "al año";

  function run(action: typeof cancel | typeof withdraw, success: (value: unknown) => string) {
    setNotice(null);
    action.mutate(undefined, {
      onSuccess: (value: unknown) => setNotice({ tone: "success", text: success(value) }),
      onError: (error) => setNotice({ tone: "danger", text: billingErrorMessage(error) }),
    });
  }

  return (
    <section aria-labelledby="suscripcion" className="motion-rise flex flex-col gap-4 rounded-lg border border-border bg-background p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tu suscripción</p>
          <h2 id="suscripcion" className="text-lg font-semibold text-foreground">
            Plan {subscription.planName}
          </h2>
          <p className="text-sm text-foreground">
            <span className="text-base font-semibold tabular-nums">{formatClp(subscription.amount)}</span> {cycleLabel}, IVA incluido
          </p>
        </div>
        <span className={cn("inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold", BADGE[status.tone])} data-testid="subscription-status">
          {status.label}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">{status.detail}</p>

      {subscription.card && !ended ? (
        <p className="flex items-center gap-2 text-sm text-foreground">
          <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
          {subscription.card.brand ?? "Tarjeta"} terminada en <span className="font-medium tabular-nums">{subscription.card.last4 ?? "····"}</span>
          <span className="text-muted-foreground">· Webpay</span>
        </p>
      ) : null}

      {subscription.withdrawalUntil && !ended ? (
        <div className="flex items-start gap-2 rounded-md bg-surface p-3 text-sm text-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p>
            Tienes derecho a retracto hasta el <strong>{formatDate(subscription.withdrawalUntil)}</strong>: puedes cancelar y recibir el reembolso total de
            lo que pagaste.
          </p>
        </div>
      ) : null}

      {notice ? (
        <p role={notice.tone === "danger" ? "alert" : "status"} className={cn("text-sm", notice.tone === "danger" ? "text-danger" : "text-success")}>
          {notice.text}
        </p>
      ) : null}

      {canManage && !ended ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {subscription.cancelAtPeriodEnd ? (
            <Button
              variant="primary"
              size="sm"
              loading={resume.isPending}
              onClick={() => run(resume, () => "Listo: tu plan sigue activo y se renovará como siempre.")}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Reanudar plan
            </Button>
          ) : (
            <ConfirmButton
              variant="secondary"
              size="sm"
              confirmLabel={`¿Cancelar? Seguirá activo hasta el ${formatDate(subscription.currentPeriodEnd)}.`}
              loading={cancel.isPending}
              onConfirm={() => run(cancel, () => `Cancelado. No volveremos a cobrarte; tu plan sigue activo hasta el ${formatDate(subscription.currentPeriodEnd)}.`)}
            >
              Cancelar plan
            </ConfirmButton>
          )}
          {subscription.withdrawalUntil ? (
            <ConfirmButton
              variant="ghost"
              size="sm"
              confirmLabel={`¿Cancelar ahora y reembolsar ${formatClp(subscription.amount)}?`}
              loading={withdraw.isPending}
              onConfirm={() =>
                run(withdraw, (value) => {
                  const refunded = (value as { refundedAmount: number }).refundedAmount;
                  return `Reembolsamos ${formatClp(refunded)} a tu tarjeta. Tu cuenta pasó al plan Gratis y conserva todo.`;
                })
              }
            >
              Cancelar y pedir reembolso
            </ConfirmButton>
          ) : null}
        </div>
      ) : null}
      {!canManage && !ended ? (
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">Solo el dueño de la organización puede cancelar o cambiar el plan.</p>
      ) : null}
    </section>
  );
}
