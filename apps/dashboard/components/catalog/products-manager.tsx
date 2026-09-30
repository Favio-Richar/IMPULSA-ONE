"use client";

import type { ProductCategoryResponse, ProductResponse } from "@impulza/contracts";
import {
  currencyFractionDigits,
  MAX_PRODUCTS_PER_SITE,
  PRODUCT_KIND_LABELS,
  PRODUCT_KINDS,
  productSchema,
  type ProductInput,
  type ProductKindValue,
} from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, EmptyState, ErrorState, Input, LoadingState, Select, Textarea } from "@impulza/ui";
import { ImagePlus, Package, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useCreateProduct, useDeleteProduct, useProductCategories, useProducts, useUpdateProduct } from "../../lib/hooks/use-catalog";
import { priceLabel } from "../bookings/bookable-services";
import { ConfirmButton } from "../confirm-button";
import { MediaPicker } from "../media/media-picker";
import { ProductFile } from "./product-file";

const CURRENCIES = ["CLP", "USD", "ARS", "PEN", "COP", "MXN", "UYU", "EUR"].map((code) => ({ value: code, label: code }));
const KIND_OPTIONS = PRODUCT_KINDS.map((kind) => ({ value: kind, label: PRODUCT_KIND_LABELS[kind] }));

/** Formulario del producto: textos tal como los escribe la persona; se convierten al guardar. */
interface ProductDraft {
  name: string;
  description: string;
  kind: ProductKindValue;
  price: string;
  priceCurrency: string;
  paymentUrl: string;
  stock: string;
  categoryId: string;
  imageUrl: string;
  imageAlt: string;
  imageDecorative: boolean;
  active: boolean;
}

const EMPTY_DRAFT: ProductDraft = {
  name: "",
  description: "",
  kind: "PHYSICAL",
  price: "",
  priceCurrency: "CLP",
  paymentUrl: "",
  stock: "",
  categoryId: "",
  imageUrl: "",
  imageAlt: "",
  imageDecorative: false,
  active: true,
};

function draftOf(product: ProductResponse): ProductDraft {
  return {
    name: product.name,
    description: product.description ?? "",
    kind: product.kind,
    price: String(product.priceAmount / 10 ** currencyFractionDigits(product.priceCurrency)),
    priceCurrency: product.priceCurrency,
    paymentUrl: product.paymentUrl ?? "",
    stock: product.stock === null ? "" : String(product.stock),
    categoryId: product.categoryId ?? "",
    imageUrl: product.image?.url ?? "",
    imageAlt: product.image?.alt ?? "",
    imageDecorative: product.image?.decorative === true,
    active: product.active,
  };
}

/**
 * Precio en la unidad mínima de la moneda (ISO 4217), igual que en los servicios reservables:
 * "12.000" o "12000" para CLP, "19,90" o "19.90" para monedas con decimales.
 */
function toInput(draft: ProductDraft): { input?: ProductInput; error?: string } {
  const digits = currencyFractionDigits(draft.priceCurrency);
  const raw = draft.price.trim();
  if (raw === "") return { error: "Escribe el precio." };
  const normalized = digits === 0 ? raw.replace(/[.,\s]/g, "") : raw.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const amount = Math.round(Number(normalized) * 10 ** digits);
  if (!Number.isFinite(amount) || amount < 0) return { error: "El precio tiene que ser un número." };
  const stockRaw = draft.stock.trim();
  const stock = stockRaw === "" ? undefined : Number(stockRaw);
  if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) return { error: "El stock tiene que ser un número entero (o vacío para no controlarlo)." };
  if (draft.imageUrl && !draft.imageDecorative && draft.imageAlt.trim() === "") return { error: "Describe la imagen o márcala como decorativa." };
  const result = productSchema.safeParse({
    name: draft.name,
    description: draft.description.trim() === "" ? undefined : draft.description,
    kind: draft.kind,
    priceAmount: amount,
    priceCurrency: draft.priceCurrency,
    paymentUrl: draft.paymentUrl.trim() === "" ? undefined : draft.paymentUrl.trim(),
    stock,
    categoryId: draft.categoryId || undefined,
    image: draft.imageUrl ? { url: draft.imageUrl, alt: draft.imageDecorative ? "" : draft.imageAlt.trim(), ...(draft.imageDecorative ? { decorative: true } : {}) } : undefined,
    active: draft.active,
  });
  return result.success ? { input: result.data } : { error: result.error.issues[0]?.message ?? "Revisa los datos." };
}

function apiMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return "Tu rol no permite cambiar el catálogo.";
  const body = error instanceof ApiError ? (error.body as { message?: unknown } | undefined) : undefined;
  return typeof body?.message === "string" ? body.message : "No se pudo guardar. Intenta de nuevo.";
}

function StockBadge({ stock }: { stock: number | null }): React.JSX.Element | null {
  if (stock === null) return null;
  const tone = stock === 0 ? "border-danger/30 bg-danger/10" : stock <= 3 ? "border-warning/40 bg-warning/10" : "border-border bg-surface";
  return <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium text-foreground", tone)}>{stock === 0 ? "Agotado" : `${stock} en stock`}</span>;
}

export function ProductsManager({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const productsQuery = useProducts(organizationId, siteId);
  const categoriesQuery = useProductCategories(organizationId, siteId);
  const [adding, setAdding] = useState(false);
  const categories = categoriesQuery.data ?? [];
  const full = (productsQuery.data?.length ?? 0) >= MAX_PRODUCTS_PER_SITE;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Productos</CardTitle>
          <CardDescription>
            Físicos, digitales o servicios. Si conectaste tu cuenta de Mercado Pago en Cobros, los pedidos se pagan en línea y el dinero
            llega directo a tu cuenta; si no, puedes pegar tu propio enlace de pago y se muestra al confirmar el pedido.
          </CardDescription>
        </div>
        {!adding && !full ? (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar producto
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {adding ? <NewProductForm organizationId={organizationId} siteId={siteId} categories={categories} onDone={() => setAdding(false)} /> : null}
        {productsQuery.isPending ? (
          <LoadingState label="Cargando productos…" />
        ) : productsQuery.isError ? (
          <ErrorState onRetry={() => productsQuery.refetch()} />
        ) : productsQuery.data.length === 0 ? (
          adding ? null : (
            <EmptyState
              title="Tu tienda está vacía"
              description="Agrega tu primer producto. En tu página cada producto aparece como un botón con su foto y su precio."
            />
          )
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" aria-label="Productos">
            {productsQuery.data.map((product) => (
              <ProductRow key={product.id} organizationId={organizationId} siteId={siteId} product={product} categories={categories} />
            ))}
          </ul>
        )}
        {full ? <p className="text-sm text-muted-foreground">Llegaste al máximo de {MAX_PRODUCTS_PER_SITE} productos por sitio.</p> : null}
      </CardContent>
    </Card>
  );
}

function ProductRow({
  organizationId,
  siteId,
  product,
  categories,
}: {
  organizationId: string;
  siteId: string;
  product: ProductResponse;
  categories: readonly ProductCategoryResponse[];
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const remove = useDeleteProduct(organizationId, siteId);
  const update = useUpdateProduct(organizationId, siteId);
  const category = categories.find((candidate) => candidate.id === product.categoryId);

  if (editing) {
    return (
      <li className="p-4">
        <EditProductForm organizationId={organizationId} siteId={siteId} product={product} categories={categories} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center" data-product={product.name}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura de la biblioteca de medios (ya optimizada), no una imagen del proyecto
          <img src={product.image.url} alt="" className="size-14 shrink-0 rounded-md border border-border object-cover" loading="lazy" />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground">
            <Package className="size-6" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
            <span className="truncate">{product.name}</span>
            {!product.active ? <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-normal text-muted-foreground">Pausado</span> : null}
            <StockBadge stock={product.stock} />
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{priceLabel(product.priceAmount, product.priceCurrency)}</span>
            <span>{PRODUCT_KIND_LABELS[product.kind]}</span>
            {category ? <span>{category.name}</span> : null}
            {product.paymentUrl ? <span>Con enlace de pago</span> : null}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          loading={update.isPending}
          onClick={() => update.mutate({ productId: product.id, changes: { active: !product.active } })}
          aria-label={`${product.active ? "Pausar" : "Activar"} ${product.name}`}
        >
          {product.active ? "Pausar" : "Activar"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Editar ${product.name}`}>
          <Pencil className="size-4" aria-hidden="true" />
          Editar
        </Button>
        <ConfirmButton
          variant="ghost"
          size="sm"
          // Con archivo en venta, borrar corta las descargas de quienes ya compraron (F5.11b).
          confirmLabel={product.downloadFile ? "¿Borrar? Sus compradores ya no podrán descargar" : "¿Borrar?"}
          loading={remove.isPending}
          onConfirm={() => remove.mutate(product.id)}
          aria-label={`Borrar ${product.name}`}
        >
          Borrar
        </ConfirmButton>
      </div>
      {product.kind === "DIGITAL" ? <ProductFile organizationId={organizationId} siteId={siteId} product={product} /> : null}
      {update.error || remove.error ? (
        <p role="alert" className="text-sm text-danger sm:basis-full">
          {apiMessage(update.error ?? remove.error)}
        </p>
      ) : null}
    </li>
  );
}

function NewProductForm({
  organizationId,
  siteId,
  categories,
  onDone,
}: {
  organizationId: string;
  siteId: string;
  categories: readonly ProductCategoryResponse[];
  onDone: () => void;
}): React.JSX.Element {
  const create = useCreateProduct(organizationId, siteId);
  return (
    <ProductForm
      organizationId={organizationId}
      title="Nuevo producto"
      initial={EMPTY_DRAFT}
      categories={categories}
      submitLabel="Agregar producto"
      pending={create.isPending}
      onCancel={onDone}
      onSubmit={async (input) => {
        await create.mutateAsync(input);
        onDone();
      }}
    />
  );
}

function EditProductForm({
  organizationId,
  siteId,
  product,
  categories,
  onDone,
}: {
  organizationId: string;
  siteId: string;
  product: ProductResponse;
  categories: readonly ProductCategoryResponse[];
  onDone: () => void;
}): React.JSX.Element {
  const update = useUpdateProduct(organizationId, siteId);
  return (
    <ProductForm
      organizationId={organizationId}
      title={`Editar ${product.name}`}
      initial={draftOf(product)}
      categories={categories}
      submitLabel="Guardar cambios"
      pending={update.isPending}
      onCancel={onDone}
      onSubmit={async (input) => {
        await update.mutateAsync({
          productId: product.id,
          changes: {
            name: input.name,
            description: input.description ?? null,
            kind: input.kind,
            priceAmount: input.priceAmount,
            priceCurrency: input.priceCurrency,
            paymentUrl: input.paymentUrl ?? null,
            stock: input.stock ?? null,
            categoryId: input.categoryId ?? null,
            image: input.image ?? null,
            active: input.active,
          },
        });
        onDone();
      }}
    />
  );
}

function ProductForm({
  organizationId,
  title,
  initial,
  categories,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  organizationId: string;
  title: string;
  initial: ProductDraft;
  categories: readonly ProductCategoryResponse[];
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: ProductInput) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const set = (changes: Partial<ProductDraft>) => setDraft((current) => ({ ...current, ...changes }));

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const { input, error: problem } = toInput(draft);
    setError(problem ?? null);
    if (!input) return;
    try {
      await onSubmit(input);
    } catch (caught) {
      setError(apiMessage(caught));
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={title} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex shrink-0 flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="group relative flex size-28 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border-strong bg-background text-muted-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            aria-label={draft.imageUrl ? "Cambiar la foto del producto" : "Elegir una foto del producto"}
          >
            {draft.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- vista previa de la biblioteca de medios
              <img src={draft.imageUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-xs">
                <ImagePlus className="size-6" aria-hidden="true" />
                Foto
              </span>
            )}
          </button>
          {draft.imageUrl ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ imageUrl: "", imageAlt: "", imageDecorative: false })}>
              Quitar foto
            </Button>
          ) : null}
        </div>
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Nombre" placeholder="Vela de soya" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required />
          <Select label="Tipo" options={KIND_OPTIONS} value={draft.kind} onChange={(e) => set({ kind: e.target.value as ProductKindValue })} />
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <Input label="Precio" inputMode="decimal" placeholder="12.000" value={draft.price} onChange={(e) => set({ price: e.target.value })} required />
            <Select label="Moneda" options={CURRENCIES} value={draft.priceCurrency} onChange={(e) => set({ priceCurrency: e.target.value })} />
          </div>
          <Input
            label="Stock (opcional)"
            inputMode="numeric"
            placeholder="Sin control"
            helperText="Vacío = sin control de stock."
            value={draft.stock}
            onChange={(e) => set({ stock: e.target.value })}
          />
          <Select
            label="Categoría"
            options={[{ value: "", label: "Sin categoría" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]}
            value={draft.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
          />
          <Input
            label="Enlace de pago (opcional)"
            type="url"
            placeholder="https://link.mercadopago.cl/…"
            value={draft.paymentUrl}
            onChange={(e) => set({ paymentUrl: e.target.value })}
          />
          {draft.imageUrl ? (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Input
                label="Descripción de la foto"
                helperText="La leen quienes usan lector de pantalla."
                value={draft.imageAlt}
                disabled={draft.imageDecorative}
                onChange={(e) => set({ imageAlt: e.target.value })}
                maxLength={300}
              />
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={draft.imageDecorative} onChange={(e) => set({ imageDecorative: e.target.checked })} />
                Es decorativa (no aporta información)
              </label>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <Textarea
              label="Descripción (opcional)"
              placeholder="Qué incluye, medidas, cómo se entrega…"
              rows={3}
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              maxLength={1000}
            />
          </div>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
        A la venta en tu página
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      {pickerOpen ? (
        <MediaPicker
          organizationId={organizationId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          hint="cuadrada, al menos 400 × 400 px"
          onSelect={(asset) => {
            if (asset.url) set({ imageUrl: asset.url });
          }}
        />
      ) : null}
    </form>
  );
}
