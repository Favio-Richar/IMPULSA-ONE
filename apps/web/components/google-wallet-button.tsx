"use client";

import { useState } from "react";

/** «Agregar a Google Wallet» (F10.4): pide la dirección firmada a la API y lleva a ella. Muestra un mensaje claro si no está disponible. */
export function GoogleWalletButton({ siteSlug }: { siteSlug: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/card/google/${encodeURIComponent(siteSlug)}`, { method: "POST", headers: { "X-Requested-With": "impulza-one" } });
      const body = (await response.json().catch(() => ({}))) as { saveUrl?: string; message?: string };
      if (response.ok && typeof body.saveUrl === "string" && body.saveUrl.startsWith("https://pay.google.com/")) {
        window.location.assign(body.saveUrl);
        return;
      }
      setError(response.status === 503 ? "Google Wallet no está disponible ahora. Puedes guardar el contacto." : "No pudimos preparar el pase. Intenta de nuevo.");
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void add()}
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] border border-[var(--site-color-border)] px-4 text-sm font-semibold text-[var(--site-color-foreground)] hover:border-[var(--site-color-foreground)] disabled:opacity-60"
      >
        {pending ? "Preparando…" : "Agregar a Google Wallet"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-[var(--site-color-foreground)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
