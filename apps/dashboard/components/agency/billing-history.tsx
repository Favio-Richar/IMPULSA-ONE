import type { AgencyBillingChange } from "@impulza/contracts";

const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });

export const BILLING_MODE_TEXT = {
  CLIENT_PAYS: "paga el negocio",
  AGENCY_PAYS: "paga la agencia",
} as const;

const STATUS_TEXT: Record<AgencyBillingChange["status"], string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  REJECTED: "Rechazado",
  CANCELED: "Cancelado",
};

/** Historial de cambios de «quién paga», de más reciente a más antiguo. Nada de cobros ni de medios de pago. */
export function BillingHistory({ history }: { history: AgencyBillingChange[] }): React.JSX.Element {
  if (history.length === 0) {
    return <p className="text-xs text-muted-foreground">Todavía no hubo cambios: sigue el modo con que empezó la relación.</p>;
  }
  return (
    <ol className="flex flex-col gap-2" data-testid="billing-history" aria-label="Historial de facturación">
      {history.map((change) => (
        <li key={change.id} className="flex flex-col gap-0.5 rounded-md border border-border p-2 text-xs">
          <p className="text-sm text-foreground">
            {change.requestedBy === "AGENCY" ? "La agencia propuso" : "El propietario pidió"}: {BILLING_MODE_TEXT[change.toMode]}
          </p>
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">{STATUS_TEXT[change.status]}</span> · {dateFormat.format(new Date(change.createdAt))}
            {change.requestedByEmail ? ` · ${change.requestedByEmail}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
