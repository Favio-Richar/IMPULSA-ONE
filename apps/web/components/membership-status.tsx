import type { PublicMembershipStatusResponse } from "@impulza/contracts";
import { formatPlanPrice } from "../lib/plan-price";

const PANEL =
  "rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-5 shadow-[var(--site-shadow)] text-[var(--site-color-foreground)]";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)]";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-4 py-2.5 text-sm font-medium text-[var(--site-color-foreground)]";

const PROCESSING = new Set(["pending", "in_process", "authorized"]);

const until = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" });

/** Qué decirle al comprador según la compra y el último estado del pago en Mercado Pago. */
export function membershipStatusView(status: PublicMembershipStatusResponse): { title: string; text: string } {
  if (status.status === "PAID") {
    return {
      title: "Pago confirmado",
      text: status.periodEnd
        ? `Tu membresía está vigente hasta el ${until.format(new Date(status.periodEnd))}. Te enviamos por correo el enlace para entrar al contenido.`
        : "Recibimos tu pago. Te enviamos por correo el enlace para entrar al contenido.",
    };
  }
  if (status.paymentStatus && PROCESSING.has(status.paymentStatus)) {
    return { title: "Pago en revisión", text: "Tu pago se está procesando. Te enviaremos el enlace por correo apenas se confirme." };
  }
  if (status.paymentStatus === "rejected" || status.paymentStatus === "cancelled") {
    return {
      title: "El pago no se completó",
      text: status.checkoutUrl ? "El pago no fue aprobado. Puedes intentarlo de nuevo con otro medio." : "El pago no fue aprobado. Vuelve al sitio para intentarlo de nuevo con otra tarjeta u otro medio.",
    };
  }
  if (status.status === "EXPIRED") {
    return { title: "La compra venció", text: "El plazo para pagar terminó. Vuelve al sitio y elige tu plan de nuevo; no se cobró nada." };
  }
  return { title: "Compra pendiente de pago", text: status.checkoutUrl ? "Tu compra está reservada. Págala con Mercado Pago para activar tu membresía." : "Tu compra aún no está pagada. Si cerraste la ventana de pago, vuelve al sitio y elige tu plan de nuevo; no se cobró nada." };
}

/** «Tu membresía»: lo que ve quien compra al volver de Mercado Pago o con el enlace de su correo. Solo lectura. */
export function MembershipStatus({ status, refreshHref }: { status: PublicMembershipStatusResponse; refreshHref: string }) {
  const view = membershipStatusView(status);
  const waiting = status.status === "PENDING" && status.paymentStatus !== null && PROCESSING.has(status.paymentStatus);
  return (
    <section className={`${PANEL} mx-auto flex max-w-md flex-col gap-4`} aria-labelledby="membership-status-title">
      <p className="text-sm text-[var(--site-color-muted-foreground)]">Tu membresía en {status.siteName}</p>
      <div role="status" className="flex flex-col gap-1">
        <h1 id="membership-status-title" className="text-xl font-semibold">
          {view.title}
        </h1>
        <p className="text-sm leading-relaxed text-[var(--site-color-muted-foreground)]">{view.text}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[var(--site-color-muted-foreground)]">Plan</dt>
        <dd className="font-medium">{status.planName}</dd>
        <dt className="text-[var(--site-color-muted-foreground)]">Total</dt>
        <dd className="font-medium">{formatPlanPrice(status.amount, status.currency)}</dd>
      </dl>
      <div className="flex flex-wrap gap-3">
        {status.checkoutUrl ? (
          <a href={status.checkoutUrl} className={PRIMARY}>
            Pagar con Mercado Pago
          </a>
        ) : null}
        {waiting ? (
          <a href={refreshHref} className={SECONDARY}>
            Actualizar estado
          </a>
        ) : null}
        <a href={`/${encodeURIComponent(status.siteSlug)}`} className={SECONDARY}>
          Volver al sitio
        </a>
      </div>
    </section>
  );
}
