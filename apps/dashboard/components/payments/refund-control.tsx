"use client";

import { currencyFractionDigits } from "@impulza/validation";
import { Button, Input } from "@impulza/ui";
import { Undo2 } from "lucide-react";
import { useId, useState } from "react";
import { ApiError } from "../../lib/api-client";

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency }).format(amount / 10 ** currencyFractionDigits(currency));
}

/** Texto → unidad mínima de la moneda ("5.000" en CLP; "19,90" con decimales). `null` = inválido. */
function parseAmount(text: string, currency: string): number | null {
  const digits = currencyFractionDigits(currency);
  const raw = text.trim();
  const normalized = digits === 0 ? raw.replace(/[.,\s$]/g, "") : raw.replace(/[\s$]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const amount = Math.round(Number(normalized) * 10 ** digits);
  return normalized !== "" && Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Mensaje claro para cada respuesta del servidor (el permiso y el tope los decide la API). */
export function refundErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 403) return "Solo el dueño del negocio puede devolver dinero.";
    const message = (error.body as { message?: unknown } | undefined)?.message;
    if ((error.status === 409 || error.status === 422 || error.status === 503) && typeof message === "string") return message;
  }
  return "No se pudo hacer la devolución. Intenta de nuevo.";
}

/**
 * Devolver dinero de un cobro con Mercado Pago (F5.11a): pedido o seña. Se abre en el mismo lugar,
 * con lo que queda por devolver ya escrito; se puede devolver una parte. Pide confirmar el monto
 * exacto antes de enviar, porque una devolución no se deshace.
 */
export function RefundControl({
  label,
  remaining,
  currency,
  pending,
  error,
  subject,
  onRefund,
}: {
  label: string;
  remaining: number;
  currency: string;
  pending: boolean;
  error: unknown;
  /** Para el nombre accesible del botón: "pedido de Ana". */
  subject: string;
  onRefund: (amount: number) => Promise<unknown>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const formId = useId();
  const amount = parseAmount(text, currency);

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setText(String(remaining / 10 ** currencyFractionDigits(currency)));
          setInvalid(null);
          setOpen(true);
        }}
        aria-label={`${label}: ${subject}`}
      >
        <Undo2 className="size-4" aria-hidden="true" />
        {label}
      </Button>
    );
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (amount === null || amount > remaining) {
      setInvalid(`Escribe un monto entre ${money(1, currency)} y ${money(remaining, currency)}.`);
      return;
    }
    setInvalid(null);
    try {
      await onRefund(amount);
      setOpen(false);
    } catch {
      // El error lo muestra `error` (viene de la mutación).
    }
  }

  const problem = invalid ?? refundErrorMessage(error);
  return (
    <form
      id={formId}
      onSubmit={submit}
      noValidate
      aria-label={`${label}: ${subject}`}
      className="flex w-full flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:w-72"
    >
      <Input
        label={`Monto a devolver (quedan ${money(remaining, currency)})`}
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(null);
        }}
        helperText="Sale de tu cuenta de Mercado Pago y vuelve al medio de pago del cliente. No se puede deshacer."
      />
      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {amount !== null && amount <= remaining ? `Devolver ${money(amount, currency)}` : "Devolver"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
