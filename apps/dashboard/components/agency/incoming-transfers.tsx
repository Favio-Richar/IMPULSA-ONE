"use client";

import { Button, ErrorState } from "@impulza/ui";
import { ArrowRightLeft } from "lucide-react";
import { useAcceptIncomingTransfer, useIncomingTransfers, useRejectIncomingTransfer } from "../../lib/hooks/use-agency";
import { errorText } from "./agency-text";

const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" });

/**
 * Clientes que otra agencia le ofrece a esta (F9.5b). Solo se muestra si hay alguno. No incluye datos del negocio, solo su nombre:
 * el traspaso se completa únicamente si el propietario del negocio también acepta, y necesita cupo de clientes en el plan.
 */
export function IncomingTransfers({ organizationId }: { organizationId: string }): React.JSX.Element | null {
  const incoming = useIncomingTransfers(organizationId, true);
  const accept = useAcceptIncomingTransfer(organizationId);
  const reject = useRejectIncomingTransfer(organizationId);

  if (incoming.isPending) return null;
  if (incoming.isError || !incoming.data) return <ErrorState onRetry={() => void incoming.refetch()} />;
  if (incoming.data.items.length === 0) return null;

  const failure = accept.error ?? reject.error;

  return (
    <section aria-labelledby="incoming-heading" className="flex flex-col gap-3 rounded-lg border border-info/40 bg-info/5 p-4" data-testid="incoming-transfers">
      <h2 id="incoming-heading" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <ArrowRightLeft className="size-4 text-info" aria-hidden="true" /> Te ofrecen un cliente
      </h2>
      <ul className="flex flex-col gap-3">
        {incoming.data.items.map((transfer) => (
          <li key={transfer.id} className="flex flex-col gap-2 rounded-md border border-border bg-background p-3" data-transfer-id={transfer.id}>
            <p className="text-sm text-foreground">
              <strong>{transfer.fromAgencyName}</strong> te ofrece el negocio <strong>«{transfer.clientName}»</strong>.
            </p>
            <p className="text-xs text-muted-foreground">
              Se completa solo si tú aceptas{transfer.ownerAccepted ? " (el propietario ya aceptó)" : " y su propietario también acepta"}. Necesitas cupo de clientes en tu plan.
              Vence el {dateFormat.format(new Date(transfer.expiresAt))}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate(transfer.id)}>
                Aceptar el cliente
              </Button>
              <Button size="sm" variant="secondary" loading={reject.isPending} onClick={() => reject.mutate(transfer.id)}>
                Rechazar
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {errorText(failure, "No pudimos hacer ese cambio.")}
        </p>
      ) : null}
    </section>
  );
}
