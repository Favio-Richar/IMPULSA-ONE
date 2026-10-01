"use client";

import { Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FormEvent } from "react";
import type { PublicCatalogResponse, PublicCouponCheckResponse, PublicOrderConfirmationResponse } from "@impulza/contracts";
import { MAX_ORDER_QUANTITY, productWithVariantName } from "@impulza/validation";
import { emitConversion } from "../lib/conversions.js";
import { formatPrice } from "../lib/format-price.js";
import { fetchJson, Notice, PRIMARY_BUTTON } from "../ui/flow.js";
import { stackSurfaceClass } from "../ui/stack-button.js";
import { SURFACE_SCOPE } from "../ui/surface.js";
import { CART_BAR_SLOT_ID } from "../lib/cart-slot.js";
import { clearCart, onCartOpenRequest, removeFromCart, setCartQuantity, useCart } from "./cart-store.js";
import { CouponField } from "./coupon-field.js";
import { CustomerFields, customerPayload, customerProblem, EMPTY_CUSTOMER, type CustomerValues } from "./customer-fields.js";
import { OrderConfirmation } from "./order-confirmation.js";

type Product = PublicCatalogResponse["products"][number];

const STEPPER =
  "flex h-11 w-11 items-center justify-center rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] text-[var(--site-color-foreground)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2";
const LINK_BUTTON = "text-sm font-medium text-[var(--site-color-foreground)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2";

interface ResolvedLine {
  key: string;
  productId: string;
  variantId?: string;
  quantity: number;
  name: string;
  unitPrice: number | null;
  maxQuantity: number;
  /** `false` si el producto o la opción ya no está a la venta (o se agotó). */
  available: boolean;
  physical: boolean;
}

/**
 * Carrito del sitio (F7.8c, ADR-023): una barra fija con el total cuando hay productos, y un panel
 * (`<dialog>` nativo: foco, Esc y fondo los maneja el navegador) con las líneas, el código de
 * descuento, los datos y el pedido. Los precios que se muestran salen del catálogo público; el total
 * que se cobra lo calcula la API al pedir (con el cupón, si lo hay).
 */
export function CartPanel({ siteSlug, base, products }: { siteSlug: string; base: string; products: Product[] }) {
  const id = useId();
  const lines = useCart(siteSlug);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [values, setValues] = useState<CustomerValues>(EMPTY_CUSTOMER);
  const [coupon, setCoupon] = useState<PublicCouponCheckResponse | null>(null);
  const [couponStale, setCouponStale] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ data: PublicOrderConfirmationResponse; lines: number } | null>(null);

  useEffect(() => onCartOpenRequest(siteSlug, () => dialogRef.current?.showModal()), [siteSlug]);
  useEffect(() => {
    if (confirmation) headingRef.current?.focus();
  }, [confirmation]);

  const resolved = useMemo<ResolvedLine[]>(() => {
    const byId = new Map(products.map((product) => [product.id, product]));
    return lines.map((line) => {
      const product = byId.get(line.productId);
      const option = line.variantId ? product?.variants.find((candidate) => candidate.id === line.variantId) : undefined;
      // Una línea sin variante de un producto que ahora tiene variantes ya no sirve: hay que elegir.
      const valid = product !== undefined && (line.variantId ? option !== undefined : product.variants.length === 0);
      const available = valid && (option ? option.available : product!.available);
      const maxQuantity = option ? option.maxQuantity : (product?.maxQuantity ?? MAX_ORDER_QUANTITY);
      return {
        key: `${line.productId}:${line.variantId ?? ""}`,
        productId: line.productId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        quantity: line.quantity,
        name: product ? productWithVariantName(product.name, option?.name) : "Producto",
        unitPrice: valid ? (option ? option.priceAmount : product!.priceAmount) : null,
        maxQuantity: Math.max(1, maxQuantity),
        available,
        physical: product?.kind === "PHYSICAL",
      };
    });
  }, [lines, products]);

  const orderable = resolved.filter((line) => line.available);
  const currency = products.find((product) => product.id === orderable[0]?.productId)?.priceCurrency ?? products[0]?.priceCurrency ?? "CLP";
  const subtotal = orderable.reduce((sum, line) => sum + (line.unitPrice ?? 0) * line.quantity, 0);
  const total = coupon ? coupon.totalAmount : subtotal;
  const needsAddress = orderable.some((line) => line.physical);
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const requestLines = orderable.map((line) => ({ productId: line.productId, ...(line.variantId ? { variantId: line.variantId } : {}), quantity: line.quantity }));

  // Cambiar el carrito invalida el descuento calculado: se quita y se pide aplicarlo de nuevo.
  function cartChanged() {
    if (coupon) {
      setCoupon(null);
      setCouponStale(true);
    }
    setError(null);
  }

  function close() {
    dialogRef.current?.close();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (orderable.length === 0) {
      setError("Tu carrito está vacío.");
      return;
    }
    if (orderable.length !== resolved.length) {
      setError("Quita los productos que ya no están disponibles para continuar.");
      return;
    }
    const problem = customerProblem(values, needsAddress);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await fetchJson<PublicOrderConfirmationResponse>(`${base}/cart/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: requestLines, ...(coupon ? { couponCode: coupon.code } : {}), ...customerPayload(values, needsAddress) }),
    });
    setSubmitting(false);
    if (result.ok) {
      setConfirmation({ data: result.data, lines: requestLines.length });
      emitConversion({ kind: "order_created", value: result.data.totalAmount, currency: result.data.priceCurrency });
      clearCart(siteSlug);
      setCoupon(null);
      setValues(EMPTY_CUSTOMER);
    } else if (result.status === 429) {
      setError("Hiciste muchos intentos seguidos. Espera unos minutos y vuelve a intentarlo.");
    } else {
      if (result.status === 422 && coupon) setCoupon(null);
      setError(result.message);
    }
  }

  // Barra con el total: al final de la página (sticky, junto a la acción principal) por un portal; si
  // la página no trae ese lugar (otra vista), se dibuja aquí mismo.
  const barContent =
    lines.length > 0 ? (
      <div className="px-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" data-cart-bar="">
        <button type="button" className={`${PRIMARY_BUTTON} w-full shadow-[0_6px_20px_-6px_rgb(15_23_42/0.35)]`} onClick={() => dialogRef.current?.showModal()}>
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          Ver carrito · {units} {units === 1 ? "unidad" : "unidades"} · {formatPrice(subtotal, currency)}
        </button>
      </div>
    ) : null;
  const slot = typeof document === "undefined" ? null : document.getElementById(CART_BAR_SLOT_ID);
  const bar = slot ? createPortal(barContent, slot) : <div className="sticky bottom-0 z-20">{barContent}</div>;

  const heading = (text: string) => (
    <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-[var(--site-color-foreground)] outline-none">
      {text}
    </h2>
  );

  return (
    <>
      {bar}

      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-titulo`}
        className="m-auto max-h-[92dvh] w-[min(100vw-1.5rem,32rem)] overflow-y-auto rounded-[var(--site-radius)] bg-transparent p-0 backdrop:bg-black/50"
        onClose={() => setConfirmation(null)}
      >
        <div className={`${SURFACE_SCOPE} ${stackSurfaceClass("secondary")} flex flex-col gap-4 p-4 sm:p-6`} data-cart-panel="">
          <div className="flex items-center justify-between gap-3">
            <span id={`${id}-titulo`}>{heading(confirmation ? "¡Pedido recibido!" : "Tu carrito")}</span>
            <button type="button" className={STEPPER} onClick={close} aria-label="Cerrar el carrito">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {confirmation ? (
            <OrderConfirmation confirmation={confirmation.data} summaryOnly={confirmation.lines > 1} />
          ) : lines.length === 0 ? (
            <p className="text-sm text-[var(--site-color-foreground)]">Tu carrito está vacío. Elige un producto y toca «Agregar al carrito».</p>
          ) : (
            <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Pedido del carrito">
              <ul className="flex flex-col divide-y divide-[var(--site-color-border)]" aria-label="Productos del carrito">
                {resolved.map((line) => (
                  <li key={line.key} className="flex flex-col gap-2 py-3 first:pt-0" data-cart-line={line.name}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-[var(--site-color-foreground)]">{line.name}</p>
                        {line.available && line.unitPrice !== null ? (
                          <p className="text-sm text-[var(--site-color-foreground)]">{formatPrice(line.unitPrice, currency)} c/u</p>
                        ) : (
                          <p className="text-sm text-[var(--site-color-foreground)]">Ya no está disponible.</p>
                        )}
                      </div>
                      {line.available && line.unitPrice !== null ? (
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--site-color-foreground)]">{formatPrice(line.unitPrice * line.quantity, currency)}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      {line.available ? (
                        <div className="flex items-center gap-2" role="group" aria-label={`Cantidad de ${line.name}`}>
                          <button
                            type="button"
                            className={STEPPER}
                            disabled={line.quantity <= 1}
                            aria-label={`Una unidad menos de ${line.name}`}
                            onClick={() => {
                              cartChanged();
                              setCartQuantity(siteSlug, line, line.quantity - 1);
                            }}
                          >
                            <Minus className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <output className="w-8 text-center text-base font-semibold tabular-nums text-[var(--site-color-foreground)]" aria-live="polite">
                            {line.quantity}
                          </output>
                          <button
                            type="button"
                            className={STEPPER}
                            disabled={line.quantity >= line.maxQuantity}
                            aria-label={`Una unidad más de ${line.name}`}
                            onClick={() => {
                              cartChanged();
                              setCartQuantity(siteSlug, line, line.quantity + 1);
                            }}
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        className={`${LINK_BUTTON} inline-flex min-h-11 items-center gap-1`}
                        aria-label={`Quitar ${line.name} del carrito`}
                        onClick={() => {
                          cartChanged();
                          removeFromCart(siteSlug, line);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Quitar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between text-sm text-[var(--site-color-foreground)]">
                <span>Subtotal</span>
                <span className="font-semibold tabular-nums">{formatPrice(subtotal, currency)}</span>
              </div>

              <CouponField
                checkUrl={`${base}/cart/coupons/check`}
                checkBody={{ lines: requestLines }}
                currency={currency}
                coupon={coupon}
                stale={couponStale}
                onChange={(next) => {
                  setCoupon(next);
                  setCouponStale(false);
                  setError(null);
                }}
              />

              <CustomerFields id={id} values={values} onChange={setValues} needsAddress={needsAddress} />
              {error ? <Notice>{error}</Notice> : null}
              <button type="submit" disabled={submitting} className={PRIMARY_BUTTON}>
                {submitting ? "Enviando pedido…" : `Hacer pedido · ${formatPrice(total, currency)}`}
              </button>
              <p className="text-xs text-[var(--site-color-muted-foreground)]">Los productos digitales se compran por separado, desde su botón.</p>
            </form>
          )}
        </div>
      </dialog>
    </>
  );
}
