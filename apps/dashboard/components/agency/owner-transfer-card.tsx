"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@impulza/ui";
import { useAcceptOwnerTransfer, useAgencyLink, useOwnerTransfer, useRejectOwnerTransfer } from "../../lib/hooks/use-agency";
import { errorText } from "./agency-text";

const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "long" });

/**
 * Traspaso de tu negocio, para el propietario (F9.5b). Solo aparece cuando hay un traspaso pendiente. Nada cambia hasta que el
 * propietario acepta; si es a otra agencia, se completa cuando ella también acepta. Los datos del negocio no se mueven.
 */
export function OwnerTransferCard({ organizationId }: { organizationId: string }): React.JSX.Element | null {
  const link = useAgencyLink(organizationId);
  const hasActiveLink = link.data != null && !link.data.awaitingOwnerDecision;
  const transfer = useOwnerTransfer(organizationId, hasActiveLink);
  const accept = useAcceptOwnerTransfer(organizationId);
  const reject = useRejectOwnerTransfer(organizationId);

  const pending = transfer.data?.transfer;
  if (!hasActiveLink || !pending || pending.status !== "PENDING") return null;

  const toAgency = pending.toKind === "AGENCY";
  const failure = accept.error ?? reject.error;

  return (
    <Card data-testid="owner-transfer-card">
      <CardHeader>
        <CardTitle className="text-base">Traspaso de tu negocio</CardTitle>
        <CardDescription>Nada cambia hasta que tú lo aceptes. Los datos de tu negocio no se mueven ni se borran.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/5 p-3" role="group" aria-label="Propuesta de traspaso" data-testid="transfer-proposal">
          <p className="text-sm text-foreground">
            {pending.fromAgencyName} propone traspasar «{pending.clientName}» {toAgency ? <>a la agencia <strong>{pending.toAgencyName}</strong></> : <>directamente <strong>a ti</strong></>}.
          </p>
          <p className="text-xs text-muted-foreground">
            {toAgency
              ? "Si aceptas, tu negocio pasa a administrarlo esa agencia —solo si ella también acepta— y la actual pierde el acceso. Quién paga el plan vuelve a empezar contigo."
              : "Si aceptas, la agencia deja de administrar tu negocio y pierde el acceso. Quién paga el plan vuelve a ser tuyo."}{" "}
            Vence el {dateFormat.format(new Date(pending.expiresAt))}.
          </p>
          {pending.ownerAccepted ? (
            <p role="status" className="text-sm text-foreground" data-testid="transfer-owner-accepted">
              Ya aceptaste. Falta la respuesta de la agencia receptora.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button loading={accept.isPending} onClick={() => accept.mutate()}>
                Aceptar el traspaso
              </Button>
              <Button variant="secondary" loading={reject.isPending} onClick={() => reject.mutate()}>
                Rechazar
              </Button>
            </div>
          )}
        </div>
        {failure ? (
          <p role="alert" className="text-sm text-danger">
            {errorText(failure, "No pudimos hacer ese cambio. Solo el propietario puede decidir.")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
