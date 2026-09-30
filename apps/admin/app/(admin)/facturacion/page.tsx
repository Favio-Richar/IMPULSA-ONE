"use client";

import type { AdminPaymentResponse, AdminRefundResponse } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, LoadingState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from "@impulza/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FileText, Receipt, RotateCcw, TrendingUp, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { RefundDialog, TaxDocumentDialog } from "../../../components/billing/payment-dialogs";
import { PageHeader, Pagination, Section } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";
import { ApiError } from "../../../lib/api-client";
import { currentMonth, formatClp, formatDate, formatInteger, formatMonth } from "../../../lib/format";

const PAGE_SIZE = 25;

type Filter = "all" | "tax-pending" | "rejected" | "refunded";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "tax-pending", label: "Boletas pendientes" },
  { key: "rejected", label: "Rechazados" },
  { key: "refunded", label: "Reembolsados" },
];

const STATUS: Record<AdminPaymentResponse["status"], { label: string; className: string }> = {
  APPROVED: { label: "Pagado", className: "bg-success/5 text-success ring-success/25" },
  REFUNDED: { label: "Reembolsado", className: "bg-info/10 text-info ring-info/25" },
  PENDING: { label: "Confirmando", className: "bg-warning/5 text-warning ring-warning/25" },
  REJECTED: { label: "Rechazado", className: "bg-danger/10 text-danger ring-danger/25" },
};

/** Una cifra que se lee sola (sin gráfico): el número grande, y abajo lo que lo explica. */
function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: string; note?: string; icon: LucideIcon; tone?: "warning" }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className={cn("size-4 shrink-0", tone === "warning" && "text-warning")} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/**
 * Facturación (F4.6d, ADR-012): ingresos de Impulza — MRR, cobros del mes, boletas pendientes y
 * reembolsos. Son los cobros de la plataforma a sus clientes, no datos comerciales de un cliente.
 */
export default function BillingPage(): React.JSX.Element {
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [taxFor, setTaxFor] = useState<AdminPaymentResponse | null>(null);
  const [refundFor, setRefundFor] = useState<AdminPaymentResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const summaryQuery = useQuery({ queryKey: ["admin", "billing", "summary", month], queryFn: () => adminApi.billingSummary(month) });
  const params = {
    // "Boletas pendientes" es de cualquier mes: es trabajo por hacer, no un reporte del mes.
    month: filter === "tax-pending" ? undefined : month,
    status: filter === "rejected" ? ("REJECTED" as const) : filter === "refunded" ? ("REFUNDED" as const) : undefined,
    taxDocument: filter === "tax-pending" ? ("PENDING" as const) : undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const paymentsQuery = useQuery({ queryKey: ["admin", "billing", "payments", params], queryFn: () => adminApi.payments(params), placeholderData: keepPreviousData });

  async function download() {
    setDownloadError(null);
    setDownloading(true);
    try {
      await adminApi.downloadPaymentsCsv(month);
    } catch (error) {
      setDownloadError(error instanceof ApiError ? error.messageOr("No se pudo descargar la planilla.") : "No se pudo descargar la planilla.");
    } finally {
      setDownloading(false);
    }
  }

  function refunded(result: AdminRefundResponse) {
    setNotice(
      result.creditNoteRequired
        ? `Reembolsamos ${formatClp(result.payment.refundedAmount)} a ${result.payment.organization.name}. La boleta N° ${result.payment.taxDocumentNumber ?? "—"} ya estaba emitida: emite una nota de crédito.`
        : `Reembolsamos ${formatClp(result.payment.refundedAmount)} a ${result.payment.organization.name}. No hace falta boleta para ese cobro.`,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Facturación"
        description="Ingresos de la plataforma: lo que pagan las organizaciones por su plan. Montos en pesos, IVA incluido."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
              Mes
              <input
                type="month"
                value={month}
                max={currentMonth()}
                onChange={(event) => {
                  if (event.target.value) {
                    setMonth(event.target.value);
                    setPage(1);
                  }
                }}
                className="h-9 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              />
            </label>
            <Button variant="secondary" onClick={download} loading={downloading}>
              <Download className="size-4" aria-hidden="true" />
              Planilla del mes (CSV)
            </Button>
          </div>
        }
      />
      {downloadError ? (
        <p role="alert" className="text-sm text-danger">
          {downloadError}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/5 p-3 text-sm text-foreground">
          {notice}
        </p>
      ) : null}

      {summaryQuery.isPending ? (
        <LoadingState label="Calculando los ingresos…" />
      ) : summaryQuery.isError ? (
        <ErrorState onRetry={() => summaryQuery.refetch()} />
      ) : (
        <>
          {summaryQuery.data.gateways.length === 0 ? (
            <p className="flex gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              Ninguna pasarela de pago está configurada en este ambiente: los clientes no pueden contratar planes en línea. Revisa las variables
              <code className="mx-1 rounded bg-surface px-1">WEBPAY_*</code>y<code className="mx-1 rounded bg-surface px-1">API_PUBLIC_URL</code>.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Ingreso mensual recurrente"
              value={formatClp(summaryQuery.data.mrr)}
              note={`ARR ${formatClp(summaryQuery.data.arr)}${summaryQuery.data.mrrAtRisk > 0 ? ` · ${formatClp(summaryQuery.data.mrrAtRisk)} en riesgo` : ""}`}
              icon={TrendingUp}
            />
            <Metric
              label="Suscripciones activas"
              value={formatInteger(summaryQuery.data.subscriptions.active)}
              note={`${formatInteger(summaryQuery.data.subscriptions.pastDue)} morosas · ${formatInteger(summaryQuery.data.subscriptions.canceling)} cancelando · +${formatInteger(summaryQuery.data.movement.newSubscriptions)} / −${formatInteger(summaryQuery.data.movement.churned)} en el mes`}
              icon={Users}
            />
            <Metric
              label={`Cobrado en ${formatMonth(summaryQuery.data.month)}`}
              value={formatClp(summaryQuery.data.collected.total)}
              note={`Neto ${formatClp(summaryQuery.data.collected.net)} · IVA ${formatClp(summaryQuery.data.collected.vat)} · reembolsado ${formatClp(summaryQuery.data.refunded)}`}
              icon={Receipt}
            />
            <button
              type="button"
              onClick={() => {
                setFilter("tax-pending");
                setPage(1);
              }}
              className="rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 [&>div]:h-full [&>div]:transition-colors [&>div]:hover:border-border-strong"
            >
              <Metric
                label="Boletas por emitir"
                value={formatInteger(summaryQuery.data.taxDocumentsPending.count)}
                note={`${formatClp(summaryQuery.data.taxDocumentsPending.total)} en total · ver la lista`}
                icon={FileText}
                tone={summaryQuery.data.taxDocumentsPending.count > 0 ? "warning" : undefined}
              />
            </button>
          </div>

          <Section title="Ingreso mensual por plan" description="Suscripciones vigentes; los planes anuales cuentan su precio dividido en 12.">
            {summaryQuery.data.byPlan.length === 0 ? (
              <EmptyState title="Todavía no hay suscripciones pagadas" description="Cuando una organización contrate un plan, aparecerá acá." />
            ) : (
              <ul className="flex flex-col gap-3">
                {summaryQuery.data.byPlan.map((plan) => {
                  const max = Math.max(1, ...summaryQuery.data.byPlan.map((row) => row.mrr));
                  return (
                    <li key={plan.planCode} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium text-foreground">{plan.planName}</span>
                        <span className="tabular-nums text-foreground">
                          {formatClp(plan.mrr)} <span className="text-muted-foreground">· {formatInteger(plan.subscriptions)} {plan.subscriptions === 1 ? "suscripción" : "suscripciones"}</span>
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-sm bg-primary/10" aria-hidden="true">
                        <div className="h-2 rounded-sm bg-primary" style={{ width: `${Math.max((plan.mrr / max) * 100, 2)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </>
      )}

      <Section
        title="Cobros"
        description={filter === "tax-pending" ? "Cobros pagados sin boleta emitida, de cualquier mes." : `Intentos de cobro de ${formatMonth(month)}.`}
        actions={
          <div role="tablist" aria-label="Filtrar cobros" className="inline-flex flex-wrap rounded-md border border-border bg-surface p-0.5">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                onClick={() => {
                  setFilter(item.key);
                  setPage(1);
                }}
                className={cn(
                  "rounded-sm px-3 py-1 text-sm font-medium transition-colors",
                  filter === item.key ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      >
        {paymentsQuery.isPending ? (
          <LoadingState label="Cargando cobros…" />
        ) : paymentsQuery.isError ? (
          <ErrorState onRetry={() => paymentsQuery.refetch()} />
        ) : paymentsQuery.data.items.length === 0 ? (
          <EmptyState
            title={filter === "tax-pending" ? "No hay boletas pendientes" : "No hay cobros"}
            description={filter === "tax-pending" ? "Todas las boletas de cobros pagados están emitidas." : "No hubo cobros con este filtro en el mes elegido."}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Organización</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Boleta</TableHead>
                  <TableHead>
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentsQuery.data.items.map((payment) => (
                  <TableRow key={payment.id} data-testid={`payment-${payment.id}`}>
                    <TableCell className="whitespace-nowrap">{formatDate(payment.paidAt ?? payment.createdAt)}</TableCell>
                    <TableCell>
                      <Link href={`/organizaciones/${payment.organization.id}`} className="font-medium text-foreground hover:underline">
                        {payment.organization.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {payment.planName}
                        {payment.attempt > 1 ? ` · intento ${payment.attempt}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <span className="font-medium tabular-nums">{formatClp(payment.amount)}</span>
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        neto {formatClp(payment.netAmount)} · IVA {formatClp(payment.vatAmount)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", STATUS[payment.status].className)}>
                        {STATUS[payment.status].label}
                      </span>
                      {payment.refundedAmount > 0 ? <span className="block text-xs text-muted-foreground">devuelto {formatClp(payment.refundedAmount)}</span> : null}
                      {payment.failureReason && payment.status !== "APPROVED" ? (
                        <span className="block text-xs text-muted-foreground">{payment.failureReason}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {payment.taxDocumentStatus === "ISSUED" ? (
                        <span className="text-sm tabular-nums text-foreground">N° {payment.taxDocumentNumber}</span>
                      ) : payment.taxDocumentStatus === "PENDING" && (payment.status === "APPROVED" || payment.status === "REFUNDED") ? (
                        <Button size="sm" variant="secondary" onClick={() => setTaxFor(payment)}>
                          Marcar emitida
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{payment.taxDocumentStatus === "NOT_REQUIRED" ? "No requiere" : "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {payment.status === "APPROVED" && payment.refundedAmount < payment.amount ? (
                        <Button size="sm" variant="ghost" onClick={() => setRefundFor(payment)}>
                          <RotateCcw className="size-4" aria-hidden="true" />
                          Reembolsar
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={paymentsQuery.data.total} onPageChange={setPage} />
          </>
        )}
      </Section>

      {taxFor ? <TaxDocumentDialog payment={taxFor} onClose={() => setTaxFor(null)} /> : null}
      {refundFor ? <RefundDialog payment={refundFor} onClose={() => setRefundFor(null)} onRefunded={refunded} /> : null}
    </div>
  );
}
