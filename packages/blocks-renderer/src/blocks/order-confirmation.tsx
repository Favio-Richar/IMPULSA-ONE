import { Check, CreditCard } from "lucide-react";
import type { PublicOrderConfirmationResponse } from "@impulza/contracts";
import { formatPrice } from "../lib/format-price.js";
import { PRIMARY_BUTTON } from "../ui/flow.js";
import { OUTBOUND_LINK } from "../ui/outbound.js";

/** Confirmación de un pedido (F5.5), suelto o de carrito: total, descuento y cómo pagar. */
export function OrderConfirmation({
  confirmation,
  heading,
  summaryOnly = false,
}: {
  confirmation: PublicOrderConfirmationResponse;
  /** Encabezado con el ícono; sin él (el panel del carrito ya trae su título), solo el detalle. */
  heading?: (text: string) => React.ReactNode;
  /** Pedido de varias líneas (F7.8c): el nombre ya es un resumen, sin "1 ×". */
  summaryOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4" role="status">
      {heading ? (
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]">
            <Check className="h-5 w-5" aria-hidden="true" />
          </span>
          {heading("¡Pedido recibido!")}
        </div>
      ) : null}
      <p className="text-sm text-[var(--site-color-foreground)]">
        <span className="font-medium">
          {summaryOnly ? confirmation.productName : `${confirmation.quantity} × ${confirmation.productName}`}
        </span>
        {confirmation.discountAmount > 0 ? (
          <>
            . Descuento{confirmation.couponCode ? ` (${confirmation.couponCode})` : ""}: −{formatPrice(confirmation.discountAmount, confirmation.priceCurrency)}
          </>
        ) : null}
        . Total: <span className="font-semibold">{formatPrice(confirmation.totalAmount, confirmation.priceCurrency)}</span>. Te enviamos el detalle por correo.
      </p>
      {confirmation.checkoutUrl ? (
        <>
          {/* Misma pestaña: Mercado Pago devuelve al comprador a "Tu pedido" con el estado del pago. */}
          <a href={confirmation.checkoutUrl} rel="noopener noreferrer" className={PRIMARY_BUTTON}>
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Pagar con Mercado Pago
          </a>
          <p className="text-xs text-[var(--site-color-muted-foreground)]">
            Pagas en el sitio de Mercado Pago y el dinero lo recibe directamente el negocio. También te enviamos el enlace por correo.
          </p>
        </>
      ) : confirmation.paymentUrl ? (
        <>
          <a href={confirmation.paymentUrl} {...OUTBOUND_LINK} className={PRIMARY_BUTTON}>
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Pagar ahora
          </a>
          <p className="text-xs text-[var(--site-color-muted-foreground)]">El pago lo recibe directamente el negocio.</p>
        </>
      ) : (
        <p className="text-sm text-[var(--site-color-foreground)]">El negocio te contactará para coordinar el pago y la entrega.</p>
      )}
    </div>
  );
}
