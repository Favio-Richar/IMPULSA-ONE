"use client";

import type { PublicUnsubscribeResponse } from "@impulza/contracts";
import { useRef, useState } from "react";

/**
 * Baja de campañas (F5.6). Pide un clic de confirmación en vez de dar de baja al abrir el enlace:
 * los escáneres de correo abren los enlaces solos y darían de baja a quien no lo pidió.
 */
export function UnsubscribeCard({ token, initial }: { token: string; initial: PublicUnsubscribeResponse }) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  async function unsubscribe() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/unsubscribe/${encodeURIComponent(token)}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as (PublicUnsubscribeResponse & { message?: string }) | null;
      if (!response.ok || !body) {
        setError(body?.message ?? "No pudimos registrar tu baja. Intenta de nuevo.");
      } else {
        setState(body);
        requestAnimationFrame(() => headingRef.current?.focus());
      }
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="baja-titulo">
      <p className="text-sm font-medium text-slate-600">{state.organizationName}</p>
      {state.unsubscribed ? (
        <div role="status">
          <h1 id="baja-titulo" ref={headingRef} tabIndex={-1} className="mt-1 text-xl font-semibold text-slate-900 outline-none">
            Listo, te diste de baja
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            No te enviaremos más correos de novedades a <span className="font-medium">{state.maskedEmail}</span>. Si tienes una reserva o un pedido, igual te
            llegarán los avisos sobre eso.
          </p>
        </div>
      ) : (
        <>
          <h1 id="baja-titulo" className="mt-1 text-xl font-semibold text-slate-900">
            ¿Dejar de recibir correos?
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            Dejarás de recibir novedades y promociones de {state.organizationName} en <span className="font-medium">{state.maskedEmail}</span>.
          </p>
          {error ? (
            <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={unsubscribe}
            disabled={pending}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60"
          >
            {pending ? "Procesando…" : "Darme de baja"}
          </button>
        </>
      )}
    </section>
  );
}
