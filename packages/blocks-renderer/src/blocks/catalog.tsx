"use client";

import { Check, Minus, Package, Plus, ShoppingBag, ShoppingCart } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PublicCatalogResponse, PublicCouponCheckResponse, PublicOrderConfirmationResponse } from "@impulza/contracts";
import { productWithVariantName, type CatalogBlockConfig } from "@impulza/validation";
import { formatPrice } from "../lib/format-price.js";
import { fetchJson, Notice, PRIMARY_BUTTON, SECONDARY_BUTTON } from "../ui/flow.js";
import { SiteImage } from "../ui/site-image.js";
import { StackButtonContent, stackButtonClass, stackSurfaceClass } from "../ui/stack-button.js";
import { SURFACE_SCOPE } from "../ui/surface.js";
import { emitConversion } from "../lib/conversions.js";
import { CartPanel } from "./cart.js";
import { addToCart, registerCartBlock, requestOpenCart, useCart, useIsCartOwner } from "./cart-store.js";
import { CouponField } from "./coupon-field.js";
import { CustomerFields, customerPayload, customerProblem, EMPTY_CUSTOMER, type CustomerValues } from "./customer-fields.js";
import { OrderConfirmation } from "./order-confirmation.js";

type Product = PublicCatalogResponse["products"][number];
type ProductVariant = Product["variants"][number];

/**
 * Precio que se muestra en el botón del producto (F7.8a): con variantes de precios distintos,
 * "Desde" el más bajo entre las disponibles (o entre todas, si no queda ninguna).
 */
export function productPriceLabel(product: Pick<Product, "priceAmount" | "priceCurrency" | "variants">): string {
  if (product.variants.length === 0) return formatPrice(product.priceAmount, product.priceCurrency);
  const pool = product.variants.some((variant) => variant.available) ? product.variants.filter((variant) => variant.available) : product.variants;
  const prices = pool.map((variant) => variant.priceAmount);
  const min = Math.min(...prices);
  const label = formatPrice(min, product.priceCurrency);
  return prices.some((price) => price !== min) ? `Desde ${label}` : label;
}

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
  const blockId = useId();
  const cartOwner = useIsCartOwner(siteSlug, blockId);
  useEffect(() => registerCartBlock(siteSlug, blockId), [siteSlug, blockId]);
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
  const currencyOf = useMemo(() => {
    const byId = new Map((catalog?.products ?? []).map((product) => [product.id, product.priceCurrency]));
    return (productId: string) => byId.get(productId) ?? null;
  }, [catalog]);

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
  // El carrito (F7.8c) usa el catálogo completo del sitio, no solo los productos de este bloque.
  const cart = cartOwner ? <CartPanel siteSlug={siteSlug} base={base} products={catalog.products} /> : null;
  // Sin productos a la venta, el bloque no ocupa lugar: la pila sigue pareja.
  if (products.length === 0) return cart;

  return (
    <>
      <ul className="flex flex-col gap-3" aria-label={config.label} data-catalog-block="">
        {products.map((product) => (
          <li key={product.id}>
            <ProductButton product={product} base={base} siteSlug={siteSlug} currencyOf={currencyOf} variant={variant} />
          </li>
        ))}
      </ul>
      {cart}
    </>
  );
}

function ProductButton({
  product,
  base,
  siteSlug,
  currencyOf,
  variant,
}: {
  product: Product;
  base: string;
  siteSlug: string;
  currencyOf: (productId: string) => string | null;
  variant: "glass" | "secondary";
}) {
  const [opened, setOpened] = useState(false);
  const price = productPriceLabel(product);
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
        {opened ? <OrderFlow product={product} base={base} siteSlug={siteSlug} currencyOf={currencyOf} /> : null}
      </div>
    </details>
  );
}

function OrderFlow({ product, base, siteSlug, currencyOf }: { product: Product; base: string; siteSlug: string; currencyOf: (productId: string) => string | null }) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [quantity, setQuantity] = useState(1);
  // Con una sola variante a la venta, queda elegida; con varias, la persona elige (nunca por defecto).
  const variants = product.variants;
  const [variantId, setVariantId] = useState<string | null>(() => {
    const available = variants.filter((candidate) => candidate.available);
    return variants.length > 0 && available.length === 1 ? available[0]!.id : null;
  });
  const selected: ProductVariant | null = variants.find((candidate) => candidate.id === variantId) ?? null;
  // Cupón (F7.8b): el descuento lo calcula el servidor para esta opción y cantidad. Si cambian, el
  // descuento calculado deja de valer: se quita y se pide aplicarlo de nuevo (nunca un total inventado).
  const [coupon, setCoupon] = useState<PublicCouponCheckResponse | null>(null);
  const [couponStale, setCouponStale] = useState(false);
  const orderChanged = () => {
    if (coupon) {
      setCoupon(null);
      setCouponStale(true);
    }
  };
  const [values, setValues] = useState<CustomerValues>(EMPTY_CUSTOMER);
  // Carrito (F7.8c): un producto digital se compra solo, así que no se agrega.
  const cartLines = useCart(siteSlug);
  const [added, setAdded] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PublicOrderConfirmationResponse | null>(null);
  const needsAddress = product.kind === "PHYSICAL";
  const maxQuantity = Math.max(1, selected ? selected.maxQuantity : product.maxQuantity);
  const unitPrice = selected ? selected.priceAmount : product.priceAmount;
  // El precio va en cada opción solo si no todas cuestan lo mismo.
  const pricesDiffer = new Set(variants.map((option) => option.priceAmount)).size > 1;

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
    if (variants.length > 0 && !selected) {
      setError("Elige una opción del producto.");
      return;
    }
    const problem = customerProblem(values, needsAddress);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await fetchJson<PublicOrderConfirmationResponse>(`${base}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: product.id,
        ...(selected ? { variantId: selected.id } : {}),
        quantity,
        ...(coupon ? { couponCode: coupon.code } : {}),
        ...customerPayload(values, needsAddress),
      }),
    });
    setSubmitting(false);
    if (result.ok) {
      setConfirmation(result.data);
      emitConversion({ kind: "order_created", value: result.data.totalAmount, currency: result.data.priceCurrency });
    } else if (result.status === 429) {
      setError("Hiciste muchos intentos seguidos. Espera unos minutos y vuelve a intentarlo.");
    } else {
      // Un cupón que dejó de valer entre que se aplicó y se pidió (se agotó, venció): se quita.
      if (result.status === 422 && coupon) setCoupon(null);
      setError(result.message);
    }
  }

  const total = formatPrice(coupon ? coupon.totalAmount : unitPrice * quantity, product.priceCurrency);
  // Moneda del carrito: la del primer producto que sigue en el catálogo.
  const cartCurrency = cartLines.map((line) => currencyOf(line.productId)).find((currency) => currency !== null) ?? null;
  function addCurrentToCart() {
    if (variants.length > 0 && !selected) {
      setError("Elige una opción del producto.");
      return;
    }
    // Una sola moneda por carrito: un producto en otra moneda se pide por separado.
    const otherCurrency = cartLines.some((line) => line.productId !== product.id) && cartCurrency !== null && cartCurrency !== product.priceCurrency;
    if (otherCurrency) {
      setError("Tu carrito tiene productos en otra moneda: pide este por separado.");
      return;
    }
    const result = addToCart(siteSlug, { productId: product.id, ...(selected ? { variantId: selected.id } : {}), quantity }, maxQuantity);
    setError(result === "full" ? "Tu carrito ya tiene 20 productos distintos: haz ese pedido primero." : null);
    setAdded(result === "added" ? productWithVariantName(product.name, selected?.name) : null);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-labelledby={`${id}-titulo`}>
      <div className="flex items-start gap-4">
        {product.image ? (
          <SiteImage image={product.image} sizes="96px" width={96} height={96} className="h-24 w-24 shrink-0 rounded-[var(--site-radius)] object-cover" />
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <span id={`${id}-titulo`}>{heading(product.name)}</span>
          <p className="text-sm font-medium text-[var(--site-color-foreground)]">
            {selected ? formatPrice(selected.priceAmount, product.priceCurrency) : productPriceLabel(product)}
          </p>
          {product.description ? <p className="whitespace-pre-line text-sm text-[var(--site-color-foreground)]">{product.description}</p> : null}
        </div>
      </div>

      {variants.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-[var(--site-color-foreground)]">Elige una opción *</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((option) => {
              const checked = option.id === variantId;
              return (
                <label
                  key={option.id}
                  className={`relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--site-radius)] border px-3 py-2 text-sm focus-within:outline-2 focus-within:outline-offset-2 ${
                    checked
                      ? "border-[var(--site-color-primary)] bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]"
                      : "border-[var(--site-color-border)] bg-[var(--site-color-background)] text-[var(--site-color-foreground)]"
                  } ${option.available ? "" : "cursor-not-allowed opacity-50 line-through"}`}
                  data-variant-option={option.name}
                >
                  <input
                    type="radio"
                    name={`${id}-variante`}
                    className="sr-only"
                    value={option.id}
                    checked={checked}
                    disabled={!option.available}
                    onChange={() => {
                      orderChanged();
                      setVariantId(option.id);
                      setQuantity((current) => Math.min(current, Math.max(1, option.maxQuantity)));
                      setError(null);
                    }}
                  />
                  <span>{option.name}</span>
                  {pricesDiffer ? (
                    <span className="tabular-nums opacity-90">{formatPrice(option.priceAmount, product.priceCurrency)}</span>
                  ) : null}
                  {option.available ? null : <span className="sr-only">(agotada)</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span id={`${id}-cantidad`} className="text-sm font-medium text-[var(--site-color-foreground)]">
          Cantidad
        </span>
        <div className="flex items-center gap-2" role="group" aria-labelledby={`${id}-cantidad`}>
          <button
            type="button"
            className={STEPPER_BUTTON}
            onClick={() => {
              orderChanged();
              setQuantity((q) => Math.max(1, q - 1));
            }} disabled={quantity <= 1} aria-label="Una unidad menos">
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <output className="w-8 text-center text-base font-semibold tabular-nums text-[var(--site-color-foreground)]" aria-live="polite">
            {quantity}
          </output>
          <button
            type="button"
            className={STEPPER_BUTTON}
            onClick={() => {
              orderChanged();
              setQuantity((q) => Math.min(maxQuantity, q + 1));
            }} disabled={quantity >= maxQuantity} aria-label="Una unidad más">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {product.kind === "DIGITAL" ? null : (
        <div className="flex flex-col gap-2">
          <button type="button" className={SECONDARY_BUTTON} onClick={addCurrentToCart}>
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            Agregar al carrito
          </button>
          {added ? (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--site-color-foreground)]" role="status">
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{added} quedó en tu carrito.</span>
              <button type="button" className="font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => requestOpenCart(siteSlug)}>
                Ver carrito
              </button>
            </p>
          ) : null}
        </div>
      )}

      <CouponField
        checkUrl={`${base}/coupons/check`}
        checkBody={{ productId: product.id, ...(selected ? { variantId: selected.id } : {}), quantity }}
        needsVariant={variants.length > 0 && !selected}
        currency={product.priceCurrency}
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
        {submitting ? "Enviando pedido…" : `Hacer pedido · ${total}`}
      </button>
    </form>
  );
}
