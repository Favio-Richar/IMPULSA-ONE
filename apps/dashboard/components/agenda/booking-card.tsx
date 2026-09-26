"use client";

import type { BookingResponse } from "@impulza/contracts";
import { BOOKING_STATUS_LABELS, currencyFractionDigits, type BookingStatusValue } from "@impulza/validation";
import { Button, cn } from "@impulza/ui";
import { Mail, MessageCircle, Phone, StickyNote } from "lucide-react";
import { ApiError } from "../../lib/api-client";
import { useUpdateBookingStatus } from "../../lib/hooks/use-agenda";

const STATUS_STYLES: Record<BookingStatusValue, string> = {
  CONFIRMED: "border-primary/30 bg-primary/10 text-foreground",
  COMPLETED: "border-success/30 bg-success/10 text-foreground",
  NO_SHOW: "border-warning/40 bg-warning/10 text-foreground",
  CANCELLED: "border-border bg-surface text-muted-foreground",
};

/** Qué se puede hacer con una reserva según su estado. */
const ACTIONS: Record<BookingStatusValue, Array<{ to: BookingStatusValue; label: string }>> = {
  CONFIRMED: [
    { to: "COMPLETED", label: "Atendida" },
    { to: "NO_SHOW", label: "No llegó" },
    { to: "CANCELLED", label: "Cancelar" },
  ],
  COMPLETED: [{ to: "CONFIRMED", label: "Deshacer" }],
  NO_SHOW: [{ to: "CONFIRMED", label: "Deshacer" }],
  CANCELLED: [{ to: "CONFIRMED", label: "Reactivar" }],
};

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency }).format(amount / 10 ** currencyFractionDigits(currency));
}

/**
 * Una reserva en la agenda (F5.3). Las acciones se muestran a todos los miembros, como en el resto
 * del panel: el servidor decide (`booking.manage`) y un rol sin permiso ve un aviso claro.
 */
export function BookingCard({ organizationId, booking }: { organizationId: string; booking: BookingResponse }): React.JSX.Element {
  const update = useUpdateBookingStatus(organizationId);
  const time = new Intl.DateTimeFormat("es-CL", { timeZone: booking.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const cancelled = booking.status === "CANCELLED";
  const whatsapp = booking.customerPhone ? `https://wa.me/${booking.customerPhone.replace(/\D/g, "")}` : null;
  const error =
    update.error instanceof ApiError && update.error.status === 409
      ? "Esa hora ya la tomó otra reserva: no se puede reactivar."
      : update.error instanceof ApiError && update.error.status === 403
        ? "Tu rol no permite cambiar reservas."
        : update.error
        ? "No se pudo cambiar el estado. Intenta de nuevo."
        : null;

  return (
    <li className={cn("flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-start", cancelled && "opacity-70")} data-booking={booking.id}>
      <div className="flex shrink-0 items-baseline gap-2 sm:w-28 sm:flex-col sm:gap-0">
        <span className={cn("text-base font-semibold tabular-nums text-foreground", cancelled && "line-through")}>{time.format(new Date(booking.startsAt))}</span>
        <span className="text-xs tabular-nums text-muted-foreground">hasta {time.format(new Date(booking.endsAt))}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-foreground">{booking.customerName}</p>
          <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", STATUS_STYLES[booking.status])}>{BOOKING_STATUS_LABELS[booking.status]}</span>
          {booking.source === "MANUAL" ? <span className="text-xs text-muted-foreground">Anotada en el panel</span> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {booking.serviceName}
          {booking.priceAmount !== null && booking.priceCurrency ? ` · ${formatMoney(booking.priceAmount, booking.priceCurrency)}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href={`mailto:${booking.customerEmail}`} className="inline-flex min-w-0 items-center gap-1 text-foreground hover:underline">
            <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{booking.customerEmail}</span>
          </a>
          {booking.customerPhone ? (
            <>
              <a href={`tel:${booking.customerPhone}`} className="inline-flex items-center gap-1 text-foreground hover:underline">
                <Phone className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {booking.customerPhone}
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
        {booking.note ? (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-foreground">
            <StickyNote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {booking.note}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 sm:justify-end">
          {ACTIONS[booking.status].map((action) => (
            <Button
              key={action.to}
              size="sm"
              variant={action.to === "CANCELLED" ? "ghost" : "secondary"}
              loading={update.isPending && update.variables?.status === action.to}
              onClick={() => update.mutate({ bookingId: booking.id, status: action.to })}
              aria-label={`${action.label}: ${booking.customerName}, ${time.format(new Date(booking.startsAt))}`}
            >
              {action.label}
            </Button>
          ))}
      </div>
    </li>
  );
}
