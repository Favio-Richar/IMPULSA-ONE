"use client";

import type { BillingPaymentResponse } from "@impulza/contracts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@impulza/ui";
import { PAYMENT_STATUS_LABELS, formatClp, formatDate } from "../../lib/billing-text";

const STATUS_STYLE: Record<BillingPaymentResponse["status"], string> = {
  APPROVED: "bg-success/5 text-success ring-1 ring-inset ring-success/25",
  REFUNDED: "bg-info/10 text-info ring-1 ring-inset ring-info/25",
  PENDING: "bg-warning/5 text-warning ring-1 ring-inset ring-warning/25",
  REJECTED: "bg-danger/10 text-danger ring-1 ring-inset ring-danger/25",
};

/** Historial de cobros con neto e IVA: el respaldo que la persona necesita para su contabilidad. */
export function PaymentHistory({ payments }: { payments: BillingPaymentResponse[] }): React.JSX.Element | null {
  if (payments.length === 0) return null;
  return (
    <section aria-labelledby="historial-pagos" className="flex flex-col gap-3">
      <h2 id="historial-pagos" className="text-base font-semibold text-foreground">
        Historial de pagos
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Período</TableHead>
            <TableHead className="text-right">Neto</TableHead>
            <TableHead className="text-right">IVA</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell className="whitespace-nowrap">{formatDate(payment.paidAt ?? payment.createdAt)}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDate(payment.periodStart)} – {formatDate(payment.periodEnd)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatClp(payment.netAmount)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatClp(payment.vatAmount)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatClp(payment.amount)}</TableCell>
              <TableCell>
                <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[payment.status])}>
                  {PAYMENT_STATUS_LABELS[payment.status]}
                  {payment.status === "REFUNDED" && payment.refundedAmount > 0 ? ` · ${formatClp(payment.refundedAmount)}` : ""}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
