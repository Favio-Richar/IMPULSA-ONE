"use client";

import type { ProductResponse, ProductVariantResponse } from "@impulza/contracts";
import { MAX_VARIANTS_PER_PRODUCT, productVariantSchema, updateProductVariantSchema } from "@impulza/validation";
import { Button, cn, Input } from "@impulza/ui";
import { ArrowDown, ArrowUp, ChevronDown, Layers, Pencil, Plus } from "lucide-react";
import { useId, useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useDeleteProductVariant, useSaveProductVariant } from "../../lib/hooks/use-catalog";
import { moneyToInput, parseMoneyInput } from "../../lib/money-input";
import { priceLabel } from "../bookings/bookable-services";
import { ConfirmButton } from "../confirm-button";

interface VariantDraft {
  name: string;
  price: string;
  stock: string;
  sku: string;
}

const EMPTY: VariantDraft = { name: "", price: "", stock: "", sku: "" };

function draftOf(variant: ProductVariantResponse, currency: string): VariantDraft {
  return {
    name: variant.name,
    price: variant.priceAmount === null ? "" : moneyToInput(variant.priceAmount, currency),
    stock: variant.stock === null ? "" : String(variant.stock),
    sku: variant.sku ?? "",
  };
}

/** Lo escrito → campos de la API. `null` en precio/stock/SKU = usar el del producto / sin control / sin SKU. */
function parseDraft(draft: VariantDraft, currency: string): { values?: { name: string; priceAmount: number | null; stock: number | null; sku: string | null }; error?: string } {
  const priceAmount = parseMoneyInput(draft.price, currency);
  if (priceAmount === "invalid") return { error: "El precio tiene que ser un número (o vacío para usar el del producto)." };
  const stockText = draft.stock.trim();
  const stock = stockText === "" ? null : Number(stockText);
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return { error: "El stock tiene que ser un número entero (o vacío para no controlarlo)." };
  const sku = draft.sku.trim() === "" ? null : draft.sku.trim();
  return { values: { name: draft.name, priceAmount, stock, sku } };
}

function apiMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return "Tu rol no permite cambiar el catálogo.";
  const body = error instanceof ApiError ? (error.body as { message?: unknown } | undefined) : undefined;
  return typeof body?.message === "string" ? body.message : "No se pudo guardar. Intenta de nuevo.";
}

function VariantStock({ stock }: { stock: number | null }): React.JSX.Element {
  if (stock === null) return <span className="text-muted-foreground">Sin control de stock</span>;
  const tone = stock === 0 ? "border-danger/30 bg-danger/10" : stock <= 3 ? "border-warning/40 bg-warning/10" : "border-border bg-surface";
  return <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium text-foreground", tone)}>{stock === 0 ? "Agotada" : `${stock} en stock`}</span>;
}

/**
 * Variantes de un producto (F7.8a, ADR-023): talla, color o formato, cada una con su precio (o el
 * del producto) y su stock. Con alguna activa, el cliente elige una al pedir y cuenta el stock de la
 * variante. La API valida todo de nuevo (nombre único, tope, permisos); acá solo se ayuda a escribir.
 */
export function ProductVariants({ organizationId, siteId, product }: { organizationId: string; siteId: string; product: ProductResponse }): React.JSX.Element {
  const [open, setOpen] = useState(product.variants.length > 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveProductVariant(organizationId, siteId, product.id);
  const remove = useDeleteProductVariant(organizationId, siteId, product.id);
  const panelId = useId();
  const variants = product.variants;
  const activeCount = variants.filter((variant) => variant.active).length;
  const full = variants.length >= MAX_VARIANTS_PER_PRODUCT;

  async function move(index: number, delta: -1 | 1): Promise<void> {
    const order = [...variants];
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved!);
    setError(null);
    try {
      // Solo las que cambian de lugar; posiciones 0..n-1 sin huecos.
      for (const [position, variant] of order.entries()) {
        if (variant.position !== position) {
          await save.mutateAsync({ variantId: variant.id, body: { position } });
        }
      }
    } catch (caught) {
      setError(apiMessage(caught));
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:basis-full">
      <button
        type="button"
        className="flex items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
          {variants.length === 0 ? "Variantes (talla, color, formato…)" : `Variantes de ${product.name} (${activeCount} a la venta)`}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open ? (
        <div id={panelId} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {activeCount > 0
              ? "Tu cliente elige una al pedir. Cada variante usa su propio stock; si no le pones precio, vale el del producto."
              : "Agrega opciones si vendes este producto en varias tallas, colores o formatos. Sin variantes, se vende tal como está."}
          </p>

          {variants.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border" aria-label={`Variantes de ${product.name}`}>
              {variants.map((variant, index) =>
                editingId === variant.id ? (
                  <li key={variant.id} className="p-3">
                    <VariantForm
                      title={`Editar variante ${variant.name}`}
                      currency={product.priceCurrency}
                      initial={draftOf(variant, product.priceCurrency)}
                      submitLabel="Guardar variante"
                      pending={save.isPending}
                      onCancel={() => setEditingId(null)}
                      onSubmit={async (values) => {
                        const parsed = updateProductVariantSchema.safeParse(values);
                        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Revisa los datos.");
                        await save.mutateAsync({ variantId: variant.id, body: parsed.data });
                        setEditingId(null);
                      }}
                    />
                  </li>
                ) : (
                  <li key={variant.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-variant={variant.name}>
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                        <span className="break-words">{variant.name}</span>
                        {!variant.active ? <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-normal text-muted-foreground">Pausada</span> : null}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="font-medium text-foreground">
                          {variant.priceAmount === null
                            ? `${priceLabel(product.priceAmount, product.priceCurrency)} (precio del producto)`
                            : priceLabel(variant.priceAmount, product.priceCurrency)}
                        </span>
                        <VariantStock stock={variant.stock} />
                        {variant.sku ? <span className="font-mono text-xs text-muted-foreground">SKU {variant.sku}</span> : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button variant="ghost" size="sm" disabled={index === 0 || save.isPending} onClick={() => void move(index, -1)} aria-label={`Subir ${variant.name}`}>
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={index === variants.length - 1 || save.isPending}
                        onClick={() => void move(index, 1)}
                        aria-label={`Bajar ${variant.name}`}
                      >
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          save.mutate({ variantId: variant.id, body: { active: !variant.active } }, { onError: (caught) => setError(apiMessage(caught)) });
                        }}
                        aria-label={`${variant.active ? "Pausar" : "Activar"} ${variant.name}`}
                      >
                        {variant.active ? "Pausar" : "Activar"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(variant.id)} aria-label={`Editar ${variant.name}`}>
                        <Pencil className="size-4" aria-hidden="true" />
                        Editar
                      </Button>
                      <ConfirmButton
                        variant="ghost"
                        size="sm"
                        confirmLabel="¿Borrarla?"
                        loading={remove.isPending}
                        onConfirm={() => {
                          setError(null);
                          remove.mutate(variant.id, { onError: (caught) => setError(apiMessage(caught)) });
                        }}
                        aria-label={`Borrar ${variant.name}`}
                      >
                        Borrar
                      </ConfirmButton>
                    </div>
                  </li>
                ),
              )}
            </ul>
          ) : null}

          {adding ? (
            <VariantForm
              title={`Nueva variante de ${product.name}`}
              currency={product.priceCurrency}
              initial={EMPTY}
              submitLabel="Agregar variante"
              pending={save.isPending}
              onCancel={() => setAdding(false)}
              onSubmit={async (values) => {
                const parsed = productVariantSchema.safeParse({
                  name: values.name,
                  ...(values.priceAmount === null ? {} : { priceAmount: values.priceAmount }),
                  ...(values.stock === null ? {} : { stock: values.stock }),
                  ...(values.sku === null ? {} : { sku: values.sku }),
                });
                if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Revisa los datos.");
                await save.mutateAsync({ variantId: null, body: parsed.data });
                setAdding(false);
              }}
            />
          ) : full ? (
            <p className="text-sm text-muted-foreground">Llegaste al máximo de {MAX_VARIANTS_PER_PRODUCT} variantes por producto.</p>
          ) : (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Agregar variante
              </Button>
            </div>
          )}

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VariantForm({
  title,
  currency,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  title: string;
  currency: string;
  initial: VariantDraft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: { name: string; priceAmount: number | null; stock: number | null; sku: string | null }) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<VariantDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (changes: Partial<VariantDraft>) => setDraft((current) => ({ ...current, ...changes }));

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const { values, error: problem } = parseDraft(draft, currency);
    setError(problem ?? null);
    if (!values) return;
    try {
      await onSubmit(values);
    } catch (caught) {
      setError(caught instanceof ApiError ? apiMessage(caught) : caught instanceof Error ? caught.message : "No se pudo guardar. Intenta de nuevo.");
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={title} className="flex flex-col gap-3 rounded-md bg-surface p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Input label="Nombre de la variante" placeholder="M / Rojo" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} required />
        <Input label={`Precio (${currency})`} inputMode="decimal" placeholder="El del producto" value={draft.price} onChange={(e) => set({ price: e.target.value })} />
        <Input label="Stock" inputMode="numeric" placeholder="Sin control" value={draft.stock} onChange={(e) => set({ stock: e.target.value })} />
        <Input label="SKU (opcional)" placeholder="POL-M-ROJO" value={draft.sku} onChange={(e) => set({ sku: e.target.value })} maxLength={40} />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
