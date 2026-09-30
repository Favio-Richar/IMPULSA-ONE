"use client";

import { Check, CreditCard, Minus, Package, Plus, ShoppingBag } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PublicCatalogResponse, PublicOrderConfirmationResponse } from "@impulza/contracts";
import { MARKETING_CONSENT_LABEL, type CatalogBlockConfig } from "@impulza/validation";
import { formatPrice } from "../lib/format-price.js";
import { fetchJson, INPUT_CLASS, Notice, PRIMARY_BUTTON } from "../ui/flow.js";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { SiteImage } from "../ui/site-image.js";
import { StackButtonContent, stackButtonClass, stackSurfaceClass } from "../ui/stack-button.js";
import { SURFACE_SCOPE } from "../ui/surface.js";
import { emitConversion } from "../lib/conversions.js";

type Product = PublicCatalogResponse["products"][number];

const STEPPER_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] text-[var(--site-color-foreground)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2";

/** Productos que muestra el bloque, según su configuración (ids elegidos o categoría). */
export function selectCatalogProducts(products: Product[], config: Pick<CatalogBlockConfig, "productIds" | "categoryId">): Product[] {
  if (config.productIds && config.productIds.length > 0) {
    const byId = new Map(products.map((product) => [product.id, product]));
    return config.productIds.map((id) => byId.get(id)).filter((product): product is Product => product !== undefined);
  }
  if (config.categoryId) {
    return products.filter((product) => product.categoryId === config.categoryId);
  }
  return products;
}

/**
 * Tienda en la página (F5.5): cada producto es un botón más de la pila (miniatura o ícono a la
 * izquierda, nombre y precio centrados) que despliega su pedido — cantidad, datos y confirmación
 * con "Pagar ahora" si el negocio tiene enlace de pago. Nunca una grilla de tarjetas (PL5). Los
 * productos y el pedido pasan por las rutas locales de `apps/web` (`/api/catalog/...`). En la vista
 * previa del constructor no se pide nada.
 */
export function CatalogBlock({
  config,
  siteSlug,
  mode = "public",
  glass = false,
}: {
  config: CatalogBlockConfig;
  siteSlug?: string;
  mode?: "public" | "preview";
  glass?: boolean;
}) {
  const variant = glass ? "glass" : "secondary";
  if (mode === "preview" || !siteSlug) {
    return (
      <div className="flex flex-col gap-3" data-catalog-block="">
        <div className={stackButtonClass(variant)}>
          <StackButtonContent icon={<ShoppingBag className="h-5 w-5 shrink-0" aria-hidden="true" />} label={config.label} description="Tus productos aparecen aquí, uno por botón" />
        </div>
      </div>
    );
  }
  return <CatalogProducts config={config} siteSlug={siteSlug} variant={variant} />;
}

function CatalogProducts({ config, siteSlug, variant }: { config: CatalogBlockConfig; siteSlug: string; variant: "glass" | "secondary" }) {
  const base = `/api/catalog/${encodeURIComponent(siteSlug)}`;
  const [catalog, setCatalog] = useState<PublicCatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<PublicCatalogResponse>(base, { cache: "no-store" }).then((result) => {
      if (cancelled) return;
      if (result.ok) setCatalog(result.data);
      else setError(result.status === 404 ? "" : result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const products = useMemo(() => (catalog ? selectCatalogProducts(catalog.products, config) : []), [catalog, config]);

  if (error !== null) {
    // Un sitio sin tienda (404) no muestra nada; un fallo real, un aviso discreto.
    return error ? <Notice>{error}</Notice> : null;
  }
  if (!catalog) {
    return (
      <div className={`${stackButtonClass(variant)} animate-pulse motion-reduce:animate-none`} role="status" aria-label="Cargando productos">
        <StackButtonContent icon={<ShoppingBag className="h-5 w-5 shrink-0" aria-hidden="true" />} label="Cargando productos…" />
      </div>
    );
  }
  // Sin productos a la venta, el bloque no ocupa lugar: la pila sigue pareja.
  if (products.length === 0) return null;

  return (
    <ul className="flex flex-col gap-3" aria-label={config.label} data-catalog-block="">
      {products.map((product) => (
        <li key={product.id}>
          <ProductButton product={product} base={base} variant={variant} />
        </li>
      ))}
    </ul>
  );
}

function ProductButton({ product, base, variant }: { product: Product; base: string; variant: "glass" | "secondary" }) {
  const [opened, setOpened] = useState(false);
  const price = formatPrice(product.priceAmount, product.priceCurrency);
  const icon = product.image ? (
    <SiteImage image={product.image} sizes="40px" width={40} height={40} className="h-10 w-10 shrink-0 rounded-[calc(var(--site-radius)/2)] object-cover" />
  ) : (
    <Package className="h-5 w-5 shrink-0" aria-hidden="true" />
  );
  const detail = product.available ? `${price} · Pedir` : `${price} · Agotado`;

  if (!product.available) {
    return (
      <div className={`${stackButtonClass(variant)} opacity-70`} data-product-button="" aria-disabled="true">
        <StackButtonContent icon={icon} label={product.name} description={detail} />
      </div>
    );
  }

  return (
    <details className="group" onToggle={(event) => setOpened((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className={`${stackButtonClass(variant)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} data-product-button="">
        <StackButtonContent icon={icon} label={product.name} description={detail} />
      </summary>
      <div className={`${SURFACE_SCOPE} mt-3 ${stackSurfaceClass("secondary")} p-4 sm:p-6`} data-order-panel="">
        {opened ? <OrderFlow product={product} base={base} /> : null}
      </div>
    </details>
  );
}

function OrderFlow({ product, base }: { product: Product; base: string }) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [quantity, setQuantity] = useState(1);
  const [values, setValues] = useState({ name: "", email: "", phone: "", address: "", note: "", consent: false, marketing: false, website: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PublicOrderConfirmationResponse | null>(null);
  const needsAddress = product.kind === "PHYSICAL";
  const maxQuantity = Math.max(1, product.maxQuantity);

  useEffect(() => {
    headingRef.current?.focus();
  }, [confirmation]);

  const heading = (text: string) => (
    <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-[var(--site-color-foreground)] outline-none">
      {text}
    </h3>
  );

  if (confirmation) {
    return <OrderConfirmation confirmation={confirmation} heading={heading} />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.name.trim() || !values.email.trim()) {
      setError("Escribe tu nombre y tu correo.");
      return;
    }
    if (needsAddress && !values.address.trim()) {
      setError("Escribe la dirección de entrega.");
      return;
    }
    if (!values.consent) {
      setError("Necesitamos tu autorización para guardar el pedido.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const phone = values.phone.replace(/[\s()-]/g, "");
    const result = await fetchJson<PublicOrderConfirmationResponse>(`${base}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: product.id,
        quantity,
        name: values.name.trim(),
        email: values.email.trim(),
        ...(phone ? { phone } : {}),
        ...(needsAddress ? { address: values.address.trim() } : {}),
        ...(values.note.trim() ? { note: values.note.trim() } : {}),
        consent: true,
        // Aparte y opcional (F5.6): solo con la casilla marcada llegan campañas.
        ...(values.marketing ? { marketingConsent: true } : {}),
        website: values.website,
      }),
    });
    setSubmitting(false);
    if (result.ok) {
      setConfirmation(result.data);
      emitConversion({ kind: "order_created", value: result.data.totalAmount, currency: result.data.priceCurrency });
    } else if (result.status === 429) {
      setError("Hiciste muchos intentos seguidos. Espera unos minutos y vuelve a intentarlo.");
    } else {
      setError(result.message);
    }
  }

  const total = formatPrice(product.priceAmount * quantity, product.priceCurrency);
  const field = (key: "name" | "email" | "phone" | "address", label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <label htmlFor={`${id}-${key}`} className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]">
        {label}
      </label>
      <input id={`${id}-${key}`} className={INPUT_CLASS} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} {...props} />
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-labelledby={`${id}-titulo`}>
      <div className="flex items-start gap-4">
        {product.image ? (
          <SiteImage image={product.image} sizes="96px" width={96} height={96} className="h-24 w-24 shrink-0 rounded-[var(--site-radius)] object-cover" />
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <span id={`${id}-titulo`}>{heading(product.name)}</span>
          <p className="text-sm font-medium text-[var(--site-color-foreground)]">{formatPrice(product.priceAmount, product.priceCurrency)}</p>
          {product.description ? <p className="whitespace-pre-line text-sm text-[var(--site-color-foreground)]">{product.description}</p> : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-cantidad`} className="text-sm font-medium text-[var(--site-color-foreground)]">
          Cantidad
        </span>
        <div className="flex items-center gap-2" role="group" aria-labelledby={`${id}-cantidad`}>
          <button type="button" className={STEPPER_BUTTON} onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Una unidad menos">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <output className="w-8 text-center text-base font-semibold tabular-nums text-[var(--site-color-foreground)]" aria-live="polite">
            {quantity}
          </output>
          <button type="button" className={STEPPER_BUTTON} onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))} disabled={quantity >= maxQuantity} aria-label="Una unidad más">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {field("name", "Nombre *", { autoComplete: "name", maxLength: 120 })}
      {field("email", "Correo *", { type: "email", autoComplete: "email", maxLength: 254 })}
      {field("phone", "Teléfono (opcional)", { type: "tel", autoComplete: "tel", placeholder: "+56 9 1234 5678" })}
      {needsAddress ? field("address", "Dirección de entrega *", { autoComplete: "street-address", maxLength: 300 }) : null}
      <div>
        <label htmlFor={`${id}-nota`} className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]">
          Comentario (opcional)
        </label>
        <textarea id={`${id}-nota`} className={INPUT_CLASS} rows={2} maxLength={500} value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
      </div>
      {/* Trampa antispam: invisible para personas, la completan los bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-web`}>Sitio web</label>
        <input id={`${id}-web`} tabIndex={-1} autoComplete="off" value={values.website} onChange={(e) => setValues({ ...values, website: e.target.value })} />
      </div>
      <label className="flex items-start gap-2 text-sm text-[var(--site-color-foreground)]">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--site-color-primary)]" checked={values.consent} onChange={(e) => setValues({ ...values, consent: e.target.checked })} />
        <span>Acepto que este negocio guarde mis datos para gestionar mi pedido. *</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-[var(--site-color-foreground)]">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--site-color-primary)]" checked={values.marketing} onChange={(e) => setValues({ ...values, marketing: e.target.checked })} />
        <span>{MARKETING_CONSENT_LABEL}</span>
      </label>
      {error ? <Notice>{error}</Notice> : null}
      <button type="submit" disabled={submitting} className={PRIMARY_BUTTON}>
        {submitting ? "Enviando pedido…" : `Hacer pedido · ${total}`}
      </button>
    </form>
  );
}

function OrderConfirmation({ confirmation, heading }: { confirmation: PublicOrderConfirmationResponse; heading: (text: string) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4" role="status">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]">
          <Check className="h-5 w-5" aria-hidden="true" />
        </span>
        {heading("¡Pedido recibido!")}
      </div>
      <p className="text-sm text-[var(--site-color-foreground)]">
        <span className="font-medium">
          {confirmation.quantity} × {confirmation.productName}
        </span>
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
