import type { PublicOrderStatusResponse } from "@impulza/contracts";

// Íconos en línea (trazo de 24 px, como el resto de la página pública): sin dependencia extra.
const ICON_PATHS = {
  check: ["M22 11.08V12a10 10 0 1 1-5.93-9.14", "m9 11 3 3L22 4"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  card: ["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M2 10h20"],
  box: ["m16 16 2 2 4-4", "M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14", "M3.29 7 12 12l8.71-5", "M12 22V12"],
  cross: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "m15 9-6 6", "m9 9 6 6"],
} as const;
type IconName = keyof typeof ICON_PATHS;

function Icon({ name, className }: { name: IconName; className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const PANEL =
  "rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-5 shadow-[var(--site-shadow)] text-[var(--site-color-foreground)] sm:p-6";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)]";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-4 py-2.5 text-sm font-medium text-[var(--site-color-foreground)]";
const ICON_BADGE = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]";

function formatPrice(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat("es-CL", { style: "currency", currency });
  return formatter.format(amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}

type View = { icon: IconName; title: string; text: string };

const PROCESSING = new Set(["pending", "in_process", "authorized"]);

/** Qué decirle al comprador según el pedido y el último estado del pago en Mercado Pago. */
export function orderStatusView(order: PublicOrderStatusResponse): View {
  if (order.status === "CANCELLED") {
    return { icon: "cross", title: "Pedido cancelado", text: "Este pedido fue cancelado. Si tienes dudas, contacta al negocio." };
  }
  if (order.status === "DELIVERED") {
    return { icon: "box", title: "Pedido entregado", text: "Tu pedido figura como entregado. ¡Gracias por tu compra!" };
  }
  if (order.status === "PAID") {
    return { icon: "check", title: "Pago confirmado", text: "Recibimos tu pago y el negocio ya fue avisado. Te enviamos la confirmación por correo." };
  }
  if (order.paymentStatus && PROCESSING.has(order.paymentStatus)) {
    return { icon: "clock", title: "Pago en revisión", text: "Mercado Pago está procesando tu pago. Te avisaremos por correo apenas se confirme." };
  }
  if (order.paymentStatus === "rejected" || order.paymentStatus === "cancelled") {
    return {
      icon: "cross",
      title: "El pago no se completó",
      text: order.checkoutUrl ? "Mercado Pago no aprobó el pago. Puedes intentarlo de nuevo con otro medio." : "Mercado Pago no aprobó el pago. Contacta al negocio para coordinarlo.",
    };
  }
  return {
    icon: "card",
    title: "Pedido pendiente de pago",
    text: order.checkoutUrl ? "Tu pedido está reservado. Págalo con Mercado Pago para confirmarlo." : "El plazo para pagar en línea venció. Contacta al negocio para coordinar el pago.",
  };
}

/**
 * "Tu pedido" (F5.9): lo que ve el comprador al volver de Mercado Pago o con el enlace de su correo,
 * con el tema del negocio. Solo lectura: el estado lo confirma el servidor consultando el pago.
 */
export function OrderStatus({ order, refreshHref }: { order: PublicOrderStatusResponse; refreshHref: string }) {
  const view = orderStatusView(order);
  const waiting = order.status === "NEW" && order.paymentStatus !== null && PROCESSING.has(order.paymentStatus);
  return (
    <section className={`${PANEL} mx-auto flex max-w-md flex-col gap-4`} aria-labelledby="order-status-title">
      <p className="text-sm text-[var(--site-color-muted-foreground)]">Tu pedido en {order.siteName}</p>
      <div className="flex items-center gap-3" role="status">
        <span className={ICON_BADGE}>
          <Icon name={view.icon} className="h-5 w-5" />
        </span>
        <h1 id="order-status-title" className="text-lg font-semibold">
          {view.title}
        </h1>
      </div>
      <p className="text-sm">
        <span className="font-medium">
          {order.quantity} × {order.productName}
        </span>
        . Total: <span className="font-semibold">{formatPrice(order.totalAmount, order.priceCurrency)}</span>
      </p>
      <p className="text-sm">{view.text}</p>
      {order.checkoutUrl ? (
        <>
          <a href={order.checkoutUrl} rel="noopener noreferrer" className={PRIMARY}>
            <Icon name="card" className="h-4 w-4" />
            Pagar con Mercado Pago
          </a>
          <p className="text-xs text-[var(--site-color-muted-foreground)]">Pagas en el sitio de Mercado Pago y el dinero lo recibe directamente el negocio.</p>
        </>
      ) : null}
      {order.downloadUrl ? (
        // Archivo comprado (F5.11b): lleva a la página de descarga, que es la que cuenta cada descarga.
        <a href={order.downloadUrl} className={PRIMARY}>
          <Icon name="box" className="h-4 w-4" />
          Ir a tu descarga
        </a>
      ) : null}
      {waiting ? (
        <a href={refreshHref} className={SECONDARY}>
          Actualizar estado
        </a>
      ) : null}
      <a href={`/${order.siteSlug}`} className="text-sm font-medium text-[var(--site-color-foreground)] underline underline-offset-4">
        Volver a {order.siteName}
      </a>
    </section>
  );
}
