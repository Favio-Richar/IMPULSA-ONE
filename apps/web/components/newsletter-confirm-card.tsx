"use client";

import type { PublicNewsletterConfirmationResponse } from "@impulza/contracts";
import { useEffect, useRef, useState } from "react";

/**
 * Confirmación de la newsletter (F7.4, ADR-019). Pide un clic en vez de confirmar al abrir el enlace:
 * los escáneres de correo abren los enlaces solos y suscribirían a quien no lo pidió.
 */
export function NewsletterConfirmCard({ token, initial }: { token: string; initial: PublicNewsletterConfirmationResponse }) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [announce, setAnnounce] = useState(false);

  // El foco va al resultado **después** de pintarlo (un `requestAnimationFrame` a veces corre antes
  // de que React lo monte y el foco se pierde): así el lector de pantalla lo anuncia siempre.
  useEffect(() => {
    if (announce && state.state === "confirmed") headingRef.current?.focus();
  }, [announce, state.state]);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/suscripcion/${encodeURIComponent(token)}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as (PublicNewsletterConfirmationResponse & { message?: string; code?: string }) | null;
      if (response.status === 410) {
        setState({ ...state, state: "expired" });
      } else if (!response.ok || !body) {
        setError(body?.message ?? "No pudimos confirmar tu suscripción. Intenta de nuevo.");
      } else {
        setState(body);
        setAnnounce(true);
      }
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="suscripcion-titulo">
      <p className="text-sm font-medium text-slate-600">{state.siteName}</p>
      {state.state === "confirmed" ? (
        <div role="status">
          <div className="mt-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 id="suscripcion-titulo" ref={headingRef} tabIndex={-1} className="mt-3 text-xl font-semibold text-slate-900 outline-none">
            ¡Listo, ya estás suscrito!
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            Te llegarán las novedades de {state.siteName} a <span className="font-medium">{state.maskedEmail}</span>. Cada correo trae un enlace para darte de baja
            cuando quieras.
          </p>
        </div>
      ) : state.state === "expired" ? (
        <div role="status">
          <h1 id="suscripcion-titulo" className="mt-1 text-xl font-semibold text-slate-900">
            Este enlace venció
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            Los enlaces de confirmación valen 48 horas. Vuelve a la página de {state.siteName} y suscríbete de nuevo: te enviaremos uno nuevo.
          </p>
        </div>
      ) : (
        <>
          <h1 id="suscripcion-titulo" className="mt-1 text-xl font-semibold text-slate-900">
            Confirma tu suscripción
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            Vas a recibir las novedades de {state.siteName} en <span className="font-medium">{state.maskedEmail}</span>. Puedes darte de baja cuando quieras.
          </p>
          {error ? (
            <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60"
          >
            {pending ? "Confirmando…" : "Confirmar suscripción"}
          </button>
          <p className="mt-3 text-center text-xs text-slate-500">Si no pediste esto, cierra esta página: sin confirmar no te escribiremos.</p>
        </>
      )}
    </section>
  );
}
