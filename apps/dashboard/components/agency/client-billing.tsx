"use client";

import type { AgencyOverviewItem } from "@impulza/contracts";
import { Button, ErrorState, LoadingState } from "@impulza/ui";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useAgencyClientBilling, useCancelAgencyBilling, useProposeAgencyBilling } from "../../lib/hooks/use-agency";
import { BillingHistory, BILLING_MODE_TEXT } from "./billing-history";
import { BILLING_TEXT, errorText } from "./agency-text";

type Mode = AgencyOverviewItem["billingMode"];

/** Solo donde la agencia trabaja (o puede volver a hacerlo): la misma regla que da acceso en el servidor. */
function canChangeBilling(item: AgencyOverviewItem): boolean {
  return item.status === "ACTIVE" || item.status === "PAUSED" || item.status === "TRANSFERRING" || (item.status === "INVITED" && item.agencyCreated);
}

/**
 * Quién paga el plan de un cliente, desde la fila de la agencia (F9.5a). La agencia propone; el propietario decide. Con
 * «paga la agencia» el negocio usa los límites del plan de la agencia: no se cobra nada nuevo ni se tocan medios de pago.
 */
export function ClientBilling({ organizationId, item }: { organizationId: string; item: AgencyOverviewItem }): React.JSX.Element {
  const propose = useProposeAgencyBilling(organizationId, item.id);
  const cancel = useCancelAgencyBilling(organizationId, item.id);
  const [proposing, setProposing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const history = useAgencyClientBilling(organizationId, item.id, showHistory);

  const target: Mode = item.billingMode === "CLIENT_PAYS" ? "AGENCY_PAYS" : "CLIENT_PAYS";
  // Un cliente que la agencia creó y cuyo propietario aún no acepta no tiene a quién pedirle la confirmación.
  const appliesNow = item.status === "INVITED" && item.agencyCreated;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="client-billing">
      <p className="text-sm text-foreground">
        Facturación: <span className="font-medium" data-testid="client-billing-mode">{BILLING_TEXT[item.billingMode]}</span>
        {item.pendingBillingMode ? (
          <span className="text-muted-foreground" data-testid="client-billing-pending">
            {" "}
            · propuesta pendiente: {BILLING_MODE_TEXT[item.pendingBillingMode]}, esperando al propietario
          </span>
        ) : null}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {item.pendingBillingMode ? (
          <Button size="sm" variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: () => setDone("Cancelaste la propuesta.") })}>
            Cancelar propuesta
          </Button>
        ) : canChangeBilling(item) && !proposing ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDone(null);
              setProposing(true);
            }}
          >
            Cambiar quién paga
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory((current) => !current)}>
          {showHistory ? "Ocultar historial" : "Ver historial"}
        </Button>
      </div>

      {proposing && !item.pendingBillingMode ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3" role="group" aria-label="Cambiar quién paga">
          <p className="text-sm text-foreground">
            {target === "AGENCY_PAYS"
              ? "Tu agencia pagaría el plan de este negocio: usará los límites de tu plan y no se le cobrará nada nuevo."
              : "El negocio volvería a pagar su propio plan y a usar sus propios límites."}
          </p>
          <p className="text-xs text-muted-foreground">
            {appliesNow
              ? "Como su propietario aún no acepta la invitación, el cambio se aplica de inmediato."
              : "Nada cambia hasta que su propietario lo confirme: le avisamos por correo y lo verá en su panel."}
          </p>
          {propose.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorText(propose.error, "No pudimos enviar la propuesta.")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={propose.isPending}
              onClick={() =>
                propose.mutate(target, {
                  onSuccess: () => {
                    setProposing(false);
                    setDone(appliesNow ? "Listo: el cambio ya rige." : "Propuesta enviada: queda pendiente del propietario.");
                  },
                })
              }
            >
              {appliesNow ? `Cambiar: ${BILLING_MODE_TEXT[target]}` : `Proponer: ${BILLING_MODE_TEXT[target]}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setProposing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {cancel.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorText(cancel.error, "No pudimos cancelar la propuesta.")}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" /> {done}
        </p>
      ) : null}

      {showHistory ? (
        history.isPending ? (
          <LoadingState label="Cargando el historial…" />
        ) : history.isError || !history.data ? (
          <ErrorState onRetry={() => void history.refetch()} />
        ) : (
          <BillingHistory history={history.data.history} />
        )
      ) : null}
    </div>
  );
}
