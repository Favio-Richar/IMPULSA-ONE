"use client";

import { Tag } from "lucide-react";
import { useId, useState } from "react";
import type { PublicCouponCheckResponse } from "@impulza/contracts";
import { formatPrice } from "../lib/format-price.js";
import { fetchJson, INPUT_CLASS, Notice } from "../ui/flow.js";

const APPLY_BUTTON =
  "flex h-11 shrink-0 items-center justify-center rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-4 text-sm font-medium text-[var(--site-color-foreground)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Código de descuento (F7.8b, ADR-023): plegado hasta que la persona lo pide. El descuento lo calcula
 * la API con la opción y la cantidad elegidas; cualquier código que no aplica recibe el mismo
 * mensaje. Al pedir, la API vuelve a validarlo y cuenta el uso.
 */
export function CouponField({
  checkUrl,
  checkBody,
  needsVariant = false,
  currency,
  coupon,
  stale,
  onChange,
}: {
  /** Ruta de prueba del código: la de un producto o la del carrito (F7.8c). */
  checkUrl: string;
  /** Lo que se pediría (producto y cantidad, o las líneas del carrito), sin el código. */
  checkBody: Record<string, unknown>;
  needsVariant?: boolean;
  currency: string;
  coupon: PublicCouponCheckResponse | null;
  stale: boolean;
  onChange: (coupon: PublicCouponCheckResponse | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (needsVariant) {
      setError("Elige una opción del producto antes de aplicar el código.");
      return;
    }
    if (code.trim() === "") {
      setError("Escribe el código.");
      return;
    }
    setError(null);
    setChecking(true);
    const result = await fetchJson<PublicCouponCheckResponse>(checkUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...checkBody, code: code.trim() }),
    });
    setChecking(false);
    if (result.ok) {
      onChange(result.data);
    } else {
      setError(result.status === 429 ? "Probaste muchos códigos seguidos. Espera unos minutos." : result.message);
    }
  }

  if (coupon) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2" role="status">
        <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--site-color-foreground)]">
          <Tag className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Código <span className="font-semibold">{coupon.code}</span>: −{formatPrice(coupon.discountAmount, currency)}
          </span>
        </span>
        <button
          type="button"
          className="shrink-0 text-sm font-medium text-[var(--site-color-foreground)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => {
            onChange(null);
            setOpen(true);
          }}
        >
          Quitar
        </button>
      </div>
    );
  }

  if (!open && !stale) {
    return (
      <button
        type="button"
        className="self-start text-sm font-medium text-[var(--site-color-foreground)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        ¿Tienes un código de descuento?
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-codigo`} className="text-sm font-medium text-[var(--site-color-foreground)]">
        Código de descuento
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-codigo`}
          className={INPUT_CLASS}
          value={code}
          maxLength={60}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void apply();
            }
          }}
        />
        <button type="button" disabled={checking} onClick={() => void apply()} className={APPLY_BUTTON}>
          {checking ? "Revisando…" : "Aplicar"}
        </button>
      </div>
      {stale ? <p className="text-sm text-[var(--site-color-foreground)]">Cambiaste el pedido: aplica el código de nuevo para ver el descuento.</p> : null}
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
