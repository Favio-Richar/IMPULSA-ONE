"use client";

import { useState } from "react";

/**
 * Canje del enlace de acceso de un miembro (F10.1). Pide un clic en vez de entrar al abrir el enlace: los escáneres de correo
 * abren los enlaces solos y gastarían el único uso del miembro antes de que él lo vea.
 */
export function MemberEnterCard({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/members/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = (await response.json().catch(() => null)) as { siteSlug?: string; message?: string } | null;
      if (response.ok && body?.siteSlug) {
        window.location.assign(`/${encodeURIComponent(body.siteSlug)}`);
        return;
      }
      setError(body?.message ?? "No pudimos validar tu enlace. Pide uno nuevo.");
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    }
    setPending(false);
  }

  return (
    <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="entrar-titulo">
      <h1 id="entrar-titulo" className="text-xl font-semibold text-slate-900">
        Entrar al contenido para miembros
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-700">Este enlace sirve una sola vez. Al continuar, tu acceso queda abierto en este navegador por 30 días.</p>
      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={enter}
        disabled={pending}
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60"
      >
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </section>
  );
}
