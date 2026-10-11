"use client";

import { useState } from "react";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)] disabled:opacity-70";

/** Webpay recibe al comprador por POST con `token_ws`: se arma un formulario y se envía, igual que con las membresías. */
function postToWebpay(url: string, fields: Record<string, string>): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

/** «Pagar con Webpay» (F10.2d): pide al servidor una transacción nueva y envía al comprador a Webpay. */
export function OrderWebpayButton({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/webpay/${encodeURIComponent(token)}`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { checkoutUrl?: string; fields?: Record<string, string>; message?: string } | null;
      if (response.ok && payload?.checkoutUrl) {
        postToWebpay(payload.checkoutUrl, payload.fields ?? {});
        return;
      }
      setError(payload?.message ?? "No pudimos iniciar el pago. Intenta de nuevo en un momento.");
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => void pay()} disabled={pending} aria-busy={pending} className={BUTTON}>
        {pending ? "Llevándote a Webpay…" : "Pagar con Webpay"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-[var(--site-color-foreground)]">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-[var(--site-color-muted-foreground)]">Pagas con tarjeta en el sitio de Webpay (Transbank) y el dinero lo recibe directamente el negocio.</p>
    </div>
  );
}
