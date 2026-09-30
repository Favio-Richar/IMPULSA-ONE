"use client";

import type { OrderResponse, SiteResponse } from "@impulza/contracts";
import { ORDER_STATUS_LABELS, PRODUCT_KIND_LABELS, type OrderStatusValue } from "@impulza/validation";
import { Button, cn, EmptyState, ErrorState, LoadingState, Select } from "@impulza/ui";
import { ChevronLeft, ChevronRight, CreditCard, Mail, MapPin, MessageCircle, Phone, ShoppingBag, StickyNote } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useOrders, useUpdateOrderStatus } from "../../lib/hooks/use-catalog";
import { formatMoney } from "../agenda/booking-card";

const TABS: Array<{ value: "" | OrderStatusValue; label: string }> = [
  { value: "", label: "Todos" },
  { value: "NEW", label: "Nuevos" },
  { value: "PAID", label: "Pagados" },
  { value: "DELIVERED", label: "Entregados" },
  { value: "CANCELLED", label: "Cancelados" },
];

const STATUS_STYLES: Record<OrderStatusValue, string> = {
  NEW: "border-primary/30 bg-primary/10 text-foreground",
  PAID: "border-success/30 bg-success/10 text-foreground",
  DELIVERED: "border-border bg-surface text-foreground",
  CANCELLED: "border-border bg-surface text-muted-foreground",
};

/** Cobro con la cuenta de Mercado Pago del negocio (F5.9), en palabras del negocio. */
export function onlinePaymentText(payment: NonNullable<OrderResponse["onlinePayment"]>, status: OrderStatusValue): string {
  if (payment.paymentId) {
    return status === "CANCELLED"
      ? `Pagado con Mercado Pago después de cancelarlo (pago ${payment.paymentId}): reactívalo o devuelve el dinero desde Mercado Pago.`
      : `Pagado con Mercado Pago · pago ${payment.paymentId}`;
  }
  if (payment.status === "pending" || payment.status === "in_process" || payment.status === "authorized") return "Pago en revisión en Mercado Pago";
  if (payment.status === "rejected" || payment.status === "cancelled") return "Mercado Pago rechazó un intento de pago";
  return status === "NEW" ? "Esperando el pago en Mercado Pago" : "Cobro en Mercado Pago sin pagar";
}

/** Qué se puede hacer con un pedido según su estado (mismas reglas que `ORDER_TRANSITIONS`). */
const ACTIONS: Record<OrderStatusValue, Array<{ to: OrderStatusValue; label: string }>> = {
  NEW: [
    { to: "PAID", label: "Marcar pagado" },
    { to: "DELIVERED", label: "Marcar entregado" },
    { to: "CANCELLED", label: "Cancelar" },
  ],
  PAID: [
    { to: "DELIVERED", label: "Marcar entregado" },
    { to: "NEW", label: "Deshacer pago" },
    { to: "CANCELLED", label: "Cancelar" },
  ],
  DELIVERED: [],
  CANCELLED: [{ to: "NEW", label: "Reabrir" }],
};

/**
 * Pedidos del negocio (F5.5): pestañas por estado con su conteo, pedidos del más nuevo al más
 * antiguo y las acciones de cada uno. El pago se marca a mano: Impulza no cobra (decisión #6).
 */
export function OrdersView({ organizationId, sites }: { organizationId: string; sites: readonly SiteResponse[] }): React.JSX.Element {
  const [siteId, setSiteId] = useState("");
  const [status, setStatus] = useState<"" | OrderStatusValue>("");
  const [page, setPage] = useState(1);
  const ordersQuery = useOrders(organizationId, { page, ...(siteId ? { siteId } : {}), ...(status ? { status } : {}) });
  const active = sites.filter((site) => site.status !== "ARCHIVED");
  const counts = ordersQuery.data?.counts;
  const all = counts ? counts.NEW + counts.PAID + counts.DELIVERED + counts.CANCELLED : null;
  const pages = ordersQuery.data ? Math.max(1, Math.ceil(ordersQuery.data.total / ordersQuery.data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Pedidos</h1>
          <p className="text-sm text-muted-foreground">Lo que te piden desde tu página. Marca el pago y la entrega a medida que avanzas.</p>
        </div>
        {active.length > 1 ? (
          <div className="w-full sm:w-64">
            <Select
              label="Sitio"
              options={[{ value: "", label: "Todos los sitios" }, ...active.map((site) => ({ value: site.id, label: site.name }))]}
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                setPage(1);
              }}
            />
          </div>
        ) : null}
      </div>

      <div role="tablist" aria-label="Filtrar por estado" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => {
          const count = tab.value ? counts?.[tab.value] : all;
          const selected = status === tab.value;
          return (
            <button
              key={tab.value || "all"}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => {
                setStatus(tab.value);
                setPage(1);
              }}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {count !== undefined && count !== null ? (
                <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", selected ? "bg-primary text-primary-foreground" : "bg-surface text-foreground")}>{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {ordersQuery.isPending ? (
        <LoadingState label="Cargando pedidos…" />
      ) : ordersQuery.isError ? (
        <ErrorState onRetry={() => ordersQuery.refetch()} />
      ) : ordersQuery.data.items.length === 0 ? (
        <EmptyState
          title={status ? `No hay pedidos ${ORDER_STATUS_LABELS[status].toLowerCase()}s` : "Todavía no hay pedidos"}
          description={status ? "Prueba con otra pestaña." : "Cuando alguien pida un producto desde tu página, aparece aquí y te llega un correo."}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3" aria-label="Pedidos" aria-busy={ordersQuery.isFetching}>
            {ordersQuery.data.items.map((order) => (
              <OrderCard key={order.id} organizationId={organizationId} order={order} siteName={active.length > 1 ? sites.find((site) => site.id === order.siteId)?.name : undefined} />
            ))}
          </ul>
          {pages > 1 ? (
            <nav className="flex items-center justify-center gap-3" aria-label="Páginas de pedidos">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior">
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <span className="text-sm tabular-nums text-foreground">
                Página {page} de {pages}
              </span>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function OrderCard({ organizationId, order, siteName }: { organizationId: string; order: OrderResponse; siteName?: string }): React.JSX.Element {
  const update = useUpdateOrderStatus(organizationId);
  const created = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(order.createdAt));
  const whatsapp = order.customerPhone ? `https://wa.me/${order.customerPhone.replace(/\D/g, "")}` : null;
  const cancelled = order.status === "CANCELLED";
  const error =
    update.error instanceof ApiError && update.error.status === 403
      ? "Tu rol no permite cambiar pedidos."
      : update.error instanceof ApiError && (update.error.status === 409 || update.error.status === 422)
        ? (((update.error.body as { message?: unknown } | undefined)?.message as string | undefined) ?? "No se pudo cambiar el estado.")
        : update.error
          ? "No se pudo cambiar el estado. Intenta de nuevo."
          : null;

  // Un pago confirmado por Mercado Pago no se deshace a mano (el servidor también lo impide).
  const actions = ACTIONS[order.status].filter((action) => !(action.to === "NEW" && order.status === "PAID" && order.onlinePayment?.paymentId));

  return (
    <li className={cn("flex flex-col gap-4 rounded-lg border border-border bg-background p-4 sm:flex-row", cancelled && "opacity-70")} data-order={order.id}>
      <div className="flex shrink-0 items-center gap-3 sm:w-44 sm:flex-col sm:items-start sm:gap-1">
        <span className="flex size-10 items-center justify-center rounded-md bg-surface text-muted-foreground">
          <ShoppingBag className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className={cn("text-base font-semibold tabular-nums text-foreground", cancelled && "line-through")}>{formatMoney(order.totalAmount, order.priceCurrency)}</p>
          <p className="text-xs text-muted-foreground">{created}</p>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{order.customerName}</p>
          <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_STYLES[order.status])}>{ORDER_STATUS_LABELS[order.status]}</span>
          {siteName ? <span className="text-xs text-muted-foreground">{siteName}</span> : null}
        </div>
        <p className="text-sm text-foreground">
          {order.quantity} × {order.productName}
          <span className="text-muted-foreground">
            {" "}
            · {formatMoney(order.unitPriceAmount, order.priceCurrency)} c/u · {PRODUCT_KIND_LABELS[order.productKind]}
          </span>
        </p>
        {order.onlinePayment ? (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-foreground">
            <CreditCard className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {onlinePaymentText(order.onlinePayment, order.status)}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href={`mailto:${order.customerEmail}`} className="inline-flex min-w-0 items-center gap-1 text-foreground hover:underline">
            <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{order.customerEmail}</span>
          </a>
          {order.customerPhone ? (
            <>
              <a href={`tel:${order.customerPhone}`} className="inline-flex items-center gap-1 text-foreground hover:underline">
                <Phone className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {order.customerPhone}
              </a>
              {whatsapp ? (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-foreground hover:underline">
                  <MessageCircle className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  WhatsApp
                </a>
              ) : null}
            </>
          ) : null}
        </div>
        {order.deliveryAddress ? (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-foreground">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {order.deliveryAddress}
          </p>
        ) : null}
        {order.note ? (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-foreground">
            <StickyNote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {order.note}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>

      {actions.length > 0 ? (
        <div className="flex flex-wrap content-start gap-2 sm:w-44 sm:flex-col sm:items-stretch">
          {actions.map((action) => (
            <Button
              key={action.to}
              size="sm"
              variant={action.to === "CANCELLED" ? "ghost" : action.to === "NEW" ? "ghost" : "secondary"}
              loading={update.isPending && update.variables?.status === action.to}
              onClick={() => update.mutate({ orderId: order.id, status: action.to })}
              aria-label={`${action.label}: pedido de ${order.customerName}`}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
