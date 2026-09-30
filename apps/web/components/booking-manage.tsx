"use client";

import { BookingTimePicker } from "@impulza/blocks-renderer";
import type { PublicBookingInfoResponse, PublicManagedBookingResponse } from "@impulza/contracts";
import { useRef, useState } from "react";

const PANEL =
  "rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-5 shadow-[var(--site-shadow)] text-[var(--site-color-foreground)] sm:p-6";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)] disabled:opacity-50";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-4 py-2.5 text-sm font-medium text-[var(--site-color-foreground)] disabled:opacity-50";

const STATUS_TEXT: Record<PublicManagedBookingResponse["status"], string> = {
  CONFIRMED: "Confirmada",
  PENDING_PAYMENT: "Esperando la seña",
  CANCELLED: "Cancelada",
  COMPLETED: "Atendida",
  NO_SHOW: "No asististe",
};

function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es-CL") + text.slice(1);
}

function formatWhen(iso: string, timeZone: string): string {
  return sentenceCase(
    new Intl.DateTimeFormat("es-CL", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)),
  );
}

function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** Qué decirle al cliente sobre su seña (F5.10), o `null` si la reserva no la cobra. */
export function depositNotice(booking: PublicManagedBookingResponse): string | null {
  const deposit = booking.deposit;
  if (!deposit || !booking.priceCurrency) return null;
  const amount = formatPrice(deposit.amount, booking.priceCurrency);
  if (deposit.paidAt) return `Seña de ${amount} pagada. ¡Gracias!`;
  if (booking.status === "PENDING_PAYMENT") {
    if (deposit.status === "in_process" || deposit.status === "pending" || deposit.status === "authorized") {
      return `Mercado Pago está revisando el pago de tu seña de ${amount}. Te avisaremos por correo apenas se confirme.`;
    }
    const until = deposit.deadline ? ` antes de las ${formatTime(deposit.deadline, booking.timeZone)}` : "";
    const retry = deposit.status === "rejected" || deposit.status === "cancelled" ? "El pago no se completó. " : "";
    return booking.checkoutUrl
      ? `${retry}Tu hora está guardada. Paga la seña de ${amount}${until} para confirmarla; si no, la hora se libera.`
      : `El plazo para pagar la seña de ${amount} venció. Si no se registró el pago, la hora se liberará.`;
  }
  if (booking.status === "CANCELLED") return `No recibimos la seña de ${amount} a tiempo y la hora se liberó.`;
  return null;
}

function formatPrice(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat("es-CL", { style: "currency", currency });
  return formatter.format(amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}

async function post(token: string, action: "cancel" | "reschedule", body: object) {
  try {
    const response = await fetch(`/api/booking-manage/${encodeURIComponent(token)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as (PublicManagedBookingResponse & { message?: string }) | null;
    return response.ok && payload ? { ok: true as const, booking: payload } : { ok: false as const, message: payload?.message ?? "No se pudo hacer el cambio. Intenta de nuevo." };
  } catch {
    return { ok: false as const, message: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo." };
  }
}

/**
 * "Tu reserva" (F5.4): lo que el cliente ve con el enlace de su correo, con el tema del negocio.
 * Cancelar pide confirmación en la misma pantalla; cambiar la hora usa el mismo selector de día y
 * hora que la reserva (horas libres calculadas por el servidor, sin contar la propia reserva).
 */
export function BookingManage({ token, initial, refreshHref }: { token: string; initial: PublicManagedBookingResponse; refreshHref: string }) {
  const [booking, setBooking] = useState(initial);
  const [mode, setMode] = useState<"view" | "confirm-cancel" | "reschedule">("view");
  const [info, setInfo] = useState<PublicBookingInfoResponse | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const heading = (text: string) => (
    <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
      {text}
    </h2>
  );

  async function cancel() {
    setBusy(true);
    const result = await post(token, "cancel", {});
    setBusy(false);
    setMode("view");
    if (result.ok) {
      setBooking(result.booking);
      setMessage({ kind: "ok", text: "Tu reserva quedó cancelada. Te enviamos un correo de confirmación." });
    } else {
      setMessage({ kind: "error", text: result.message });
    }
  }

  async function startReschedule() {
    setMessage(null);
    if (!info) {
      const response = await fetch(`/api/bookings/${encodeURIComponent(booking.siteSlug)}`, { cache: "no-store" }).catch(() => null);
      const data = response?.ok ? ((await response.json()) as PublicBookingInfoResponse) : null;
      if (!data || !data.services.some((service) => service.id === booking.serviceId)) {
        setMessage({ kind: "error", text: "Por ahora no se puede cambiar la hora en línea. Contacta directamente al negocio." });
        return;
      }
      setInfo(data);
    }
    setMode("reschedule");
  }

  async function reschedule(startsAt: string) {
    setBusy(true);
    const result = await post(token, "reschedule", { startsAt });
    setBusy(false);
    if (result.ok) {
      setBooking(result.booking);
      setMode("view");
      setMessage({ kind: "ok", text: "Listo: tu reserva quedó en la nueva hora. Te enviamos un correo con el detalle." });
    } else {
      setMessage({ kind: "error", text: result.message });
    }
  }

  const service = info?.services.find((candidate) => candidate.id === booking.serviceId);
  const notice = depositNotice(booking);
  const pendingReview = booking.deposit?.status === "in_process" || booking.deposit?.status === "pending" || booking.deposit?.status === "authorized";

  return (
    <div className="flex flex-col gap-4">
      <div className={PANEL}>
        <p className="text-sm text-[var(--site-color-muted-foreground)]">{booking.siteName}</p>
        <h1 className="mt-1 text-2xl font-semibold" style={{ fontFamily: "var(--site-font-heading)" }}>
          Tu reserva
        </h1>
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt className="text-[var(--site-color-muted-foreground)]">Servicio</dt>
          <dd className="font-medium">{booking.serviceName}</dd>
          <dt className="text-[var(--site-color-muted-foreground)]">Cuándo</dt>
          <dd className={booking.status === "CANCELLED" ? "line-through" : ""}>{formatWhen(booking.startsAt, booking.timeZone)}</dd>
          {booking.priceAmount !== null && booking.priceCurrency ? (
            <>
              <dt className="text-[var(--site-color-muted-foreground)]">Valor</dt>
              <dd>{formatPrice(booking.priceAmount, booking.priceCurrency)}</dd>
            </>
          ) : null}
          <dt className="text-[var(--site-color-muted-foreground)]">Estado</dt>
          <dd className="font-medium">{STATUS_TEXT[booking.status]}</dd>
        </dl>

        {notice ? (
          <p role="status" className="mt-4 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2 text-sm">
            {notice}
          </p>
        ) : null}

        {message ? (
          <p role={message.kind === "error" ? "alert" : "status"} className="mt-4 flex items-start gap-2 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2 text-sm">
            {message.text}
          </p>
        ) : null}

        {mode === "view" ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {booking.checkoutUrl ? (
              // Misma pestaña: Mercado Pago devuelve al cliente aquí, con el estado de la seña.
              <a href={booking.checkoutUrl} rel="noopener noreferrer" className={PRIMARY}>
                Pagar la seña con Mercado Pago
              </a>
            ) : null}
            {booking.status === "PENDING_PAYMENT" && pendingReview ? (
              <a href={refreshHref} className={SECONDARY}>
                Actualizar estado
              </a>
            ) : null}
            {booking.paymentUrl ? (
              <a href={booking.paymentUrl} rel="nofollow noopener noreferrer" className={PRIMARY}>
                Pagar ahora
              </a>
            ) : null}
            {booking.canChange ? (
              <>
                {booking.serviceId ? (
                  <button type="button" className={SECONDARY} onClick={startReschedule} disabled={busy}>
                    Cambiar la hora
                  </button>
                ) : null}
                <button type="button" className={SECONDARY} onClick={() => setMode("confirm-cancel")} disabled={busy}>
                  Cancelar la reserva
                </button>
              </>
            ) : booking.status === "CONFIRMED" ? (
              <p className="text-sm text-[var(--site-color-muted-foreground)]">
                El plazo para cambiarla en línea ya pasó. Si necesitas algo, contacta directamente al negocio.
              </p>
            ) : null}
          </div>
        ) : null}

        {mode === "confirm-cancel" ? (
          <div className="mt-5 flex flex-col gap-3" role="group" aria-label="Confirmar cancelación">
            <p className="text-sm">¿Seguro que quieres cancelar? La hora quedará libre para otra persona.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className={PRIMARY} onClick={cancel} disabled={busy}>
                {busy ? "Cancelando…" : "Sí, cancelar"}
              </button>
              <button type="button" className={SECONDARY} onClick={() => setMode("view")} disabled={busy}>
                No, mantenerla
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {mode === "reschedule" && info && service ? (
        <div className={PANEL} aria-busy={busy}>
          <BookingTimePicker
            base={`/api/bookings/${encodeURIComponent(booking.siteSlug)}`}
            service={service}
            timeZone={info.timeZone}
            maxAdvanceDays={info.maxAdvanceDays}
            heading={heading}
            title="Elige la nueva hora"
            backLabel="Volver"
            onBack={() => setMode("view")}
            onPick={(slot) => void reschedule(slot)}
          />
        </div>
      ) : null}

      <p className="text-center text-sm">
        <a href={`/${booking.siteSlug}`} className="underline underline-offset-2">
          Ir a la página de {booking.siteName}
        </a>
      </p>
    </div>
  );
}
