"use client";

import type { AdminPaymentResponse, AdminRefundResponse } from "@impulza/contracts";
import { Button, Dialog, Input } from "@impulza/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { adminApi } from "../../lib/api";
import { ApiError } from "../../lib/api-client";
import { formatClp, formatDate } from "../../lib/format";
import { ReasonField } from "../reason-field";

function useInvalidateBilling() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.messageOr(fallback) : fallback;
}

/** Registrar el folio de la boleta emitida ante el SII para un cobro. */
export function TaxDocumentDialog({ payment, onClose }: { payment: AdminPaymentResponse; onClose: () => void }): React.JSX.Element {
  const [documentNumber, setDocumentNumber] = useState("");
  const invalidate = useInvalidateBilling();
  const mutation = useMutation({
    mutationFn: () => adminApi.markTaxDocument(payment.id, documentNumber.trim()),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  const fieldError = mutation.error instanceof ApiError ? mutation.error.issues.find((issue) => issue.path.includes("documentNumber"))?.message : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title="Marcar la boleta como emitida"
      description={`${payment.organization.name} · ${formatClp(payment.amount)} del ${formatDate(payment.paidAt ?? payment.createdAt)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={documentNumber.trim().length === 0}>
            Guardar folio
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-2 rounded-md bg-surface p-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Neto</dt>
            <dd className="tabular-nums">{formatClp(payment.netAmount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">IVA</dt>
            <dd className="tabular-nums">{formatClp(payment.vatAmount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Total</dt>
            <dd className="font-semibold tabular-nums">{formatClp(payment.amount)}</dd>
          </div>
        </dl>
        <Input
          label="Folio del documento"
          inputMode="numeric"
          autoComplete="off"
          value={documentNumber}
          onChange={(event) => setDocumentNumber(event.target.value)}
          error={fieldError}
          helperText="El número de la boleta o factura electrónica emitida en el SII o en tu sistema de facturación."
        />
        {mutation.isError && !fieldError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(mutation.error, "No se pudo guardar el folio.")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Reembolso manual por el equipo, con motivo obligatorio. */
export function RefundDialog({
  payment,
  onClose,
  onRefunded,
}: {
  payment: AdminPaymentResponse;
  onClose: () => void;
  onRefunded: (result: AdminRefundResponse) => void;
}): React.JSX.Element {
  const [reason, setReason] = useState("");
  const invalidate = useInvalidateBilling();
  const pending = payment.amount - payment.refundedAmount;
  const mutation = useMutation({
    mutationFn: () => adminApi.refundPayment(payment.id, reason.trim()),
    onSuccess: async (result) => {
      await invalidate();
      onRefunded(result);
      onClose();
    },
  });
  const reasonError = mutation.error instanceof ApiError ? mutation.error.issues.find((issue) => issue.path.includes("reason"))?.message : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => (!open && !mutation.isPending ? onClose() : undefined)}
      title={`Reembolsar ${formatClp(pending)}`}
      description={`${payment.organization.name} · plan ${payment.planName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={reason.trim().length < 10}>
            Reembolsar {formatClp(pending)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-foreground">
          Se devuelve por Transbank a la misma tarjeta y se avisa al dueño por correo. La suscripción <strong>no</strong> se cancela: eso lo decide el
          cliente.
        </p>
        {payment.taxDocumentStatus === "ISSUED" ? (
          <p className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            La boleta {payment.taxDocumentNumber ? `N° ${payment.taxDocumentNumber} ` : ""}ya está emitida: después del reembolso tendrás que emitir una nota de crédito
            por {formatClp(pending)}.
          </p>
        ) : null}
        <ReasonField value={reason} onChange={setReason} error={reasonError} />
        {mutation.isError && !reasonError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(mutation.error, "No se pudo reembolsar.")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
