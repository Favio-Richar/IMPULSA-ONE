"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, LoadingState } from "@impulza/ui";
import { useAgencyLink, useChangeOwnerBilling, useConfirmOwnerBilling, useOwnerBilling, useRejectOwnerBilling } from "../../lib/hooks/use-agency";
import { ConfirmButton } from "../confirm-button";
import { errorText } from "./agency-text";
import { BillingHistory, BILLING_MODE_TEXT } from "./billing-history";

/**
 * «Quién paga tu plan», para el propietario del negocio (F9.5a). La agencia propone; nada cambia hasta que el propietario lo
 * confirma. Con «paga la agencia» el negocio usa los límites del plan de la agencia. No muestra suscripción ni medios de pago.
 */
export function OwnerBillingCard({ organizationId }: { organizationId: string }): React.JSX.Element | null {
  const link = useAgencyLink(organizationId);
  // Sin agencia vinculada, o con una solicitud que aún no se acepta, no hay nada que decidir sobre la facturación.
  const hasActiveLink = link.data != null && !link.data.awaitingOwnerDecision;
  const billing = useOwnerBilling(organizationId, hasActiveLink);
  const confirm = useConfirmOwnerBilling(organizationId);
  const reject = useRejectOwnerBilling(organizationId);
  const change = useChangeOwnerBilling(organizationId);

  if (!hasActiveLink || !link.data) return null;

  const failure = confirm.error ?? reject.error ?? change.error;

  return (
    <Card data-testid="owner-billing-card">
      <CardHeader>
        <CardTitle className="text-base">Quién paga tu plan</CardTitle>
        <CardDescription>La agencia puede ofrecerse a pagar el plan de tu negocio. Tú decides: nada cambia sin tu confirmación.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {billing.isPending ? (
          <LoadingState label="Cargando…" />
        ) : billing.isError || !billing.data ? (
          <ErrorState onRetry={() => void billing.refetch()} />
        ) : (
          <>
            <p className="text-sm text-foreground" data-testid="owner-billing-mode">
              {billing.data.billingMode === "AGENCY_PAYS"
                ? `Hoy paga ${link.data.agencyName}: tu negocio usa los límites de su plan y tú no pagas un plan propio.`
                : "Hoy pagas tú el plan de tu negocio."}
            </p>
            {billing.data.billingMode === "AGENCY_PAYS" ? (
              <p className="text-xs text-muted-foreground">Si ya tienes una suscripción propia vigente, esa sigue mandando hasta que la canceles.</p>
            ) : null}

            {billing.data.pending ? (
              <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/5 p-3" role="group" aria-label="Propuesta de la agencia" data-testid="billing-proposal">
                <p className="text-sm text-foreground">
                  {link.data.agencyName} propone que, desde ahora, <strong>{BILLING_MODE_TEXT[billing.data.pending.toMode]}</strong>.
                  {billing.data.pending.toMode === "AGENCY_PAYS"
                    ? " Tu negocio usaría los límites del plan de la agencia y no se te cobraría nada por esto."
                    : " Tu negocio volvería a su propio plan y a sus propios límites."}{" "}
                  Nada cambia hasta que lo confirmes.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button loading={confirm.isPending} onClick={() => confirm.mutate()}>
                    Confirmar el cambio
                  </Button>
                  <Button variant="secondary" loading={reject.isPending} onClick={() => reject.mutate()}>
                    Rechazar
                  </Button>
                </div>
              </div>
            ) : billing.data.billingMode === "AGENCY_PAYS" ? (
              <div className="flex flex-wrap gap-2">
                <ConfirmButton
                  variant="secondary"
                  confirmLabel="¿Volver a pagar tu plan? Dejarás de usar el plan de la agencia."
                  loading={change.isPending}
                  onConfirm={() => change.mutate("CLIENT_PAYS")}
                >
                  Volver a pagar yo
                </ConfirmButton>
              </div>
            ) : null}

            {failure ? (
              <p role="alert" className="text-sm text-danger">
                {errorText(failure, "No pudimos hacer ese cambio. Solo el propietario puede decidir.")}
              </p>
            ) : null}

            <details className="rounded-md border border-border">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                Historial de cambios
              </summary>
              <div className="p-3 pt-1">
                <BillingHistory history={billing.data.history} />
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
