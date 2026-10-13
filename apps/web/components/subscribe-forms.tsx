"use client";

import { SUBSCRIBE_HONEYPOT_FIELD } from "@impulza/validation";
import { useId, useState } from "react";

type Phase = "idle" | "sending" | "sent";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT =
  "min-h-11 w-full rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2 text-sm text-[var(--site-color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2";
const BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

/**
 * Suscripción gratuita: correo (y nombre, si quiere) y un enlace de acceso a su bandeja. La respuesta es la misma pase lo que
 * pase, así que el mensaje de éxito no confirma nada de nadie. Mientras el negocio no tenga plan de pago, es todo lo que hay.
 */
export function FreeSubscribeForm({ siteSlug, siteName }: { siteSlug: string; siteName: string }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [trap, setTrap] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "sending") return;
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Escribe un correo válido, por ejemplo nombre@correo.cl.");
      return;
    }
    setPhase("sending");
    setError(null);
    try {
      const response = await fetch(`/api/subscribe/${encodeURIComponent(siteSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), ...(name.trim() ? { name: name.trim() } : {}), [SUBSCRIBE_HONEYPOT_FIELD]: trap }),
      });
      if (response.ok) {
        setPhase("sent");
        return;
      }
      setError(response.status === 429 ? "Hiciste muchos intentos seguidos. Espera unos minutos e intenta de nuevo." : "No pudimos completar tu suscripción ahora. Intenta de nuevo en un momento.");
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    }
    setPhase("idle");
  }

  if (phase === "sent") {
    return (
      <div role="status" className="flex flex-col gap-1 rounded-[var(--site-radius)] border border-[var(--site-color-border)] p-4">
        <p className="font-medium text-[var(--site-color-foreground)]">Revisa tu correo</p>
        <p className="text-sm text-[var(--site-color-muted-foreground)]">
          Te enviamos un enlace para entrar a {siteName}. Vence en 15 minutos y sirve una sola vez. Si no lo ves, busca en spam o promociones.
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-describedby={error ? `${id}-error` : undefined}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-email`} className="text-sm font-medium text-[var(--site-color-foreground)]">
          Tu correo
        </label>
        <input id={`${id}-email`} type="email" autoComplete="email" inputMode="email" maxLength={254} className={INPUT} value={email} onChange={(event) => { setEmail(event.target.value); if (error) setError(null); }} aria-invalid={error ? true : undefined} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium text-[var(--site-color-foreground)]">
          Tu nombre <span className="font-normal text-[var(--site-color-muted-foreground)]">(opcional)</span>
        </label>
        <input id={`${id}-name`} autoComplete="name" maxLength={120} className={INPUT} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      {/* Campo trampa: fuera de la vista y del tabulador; una persona nunca lo llena. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-trap`}>Sitio web</label>
        <input id={`${id}-trap`} type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(event) => setTrap(event.target.value)} />
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-[var(--site-color-foreground)]">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={phase === "sending"} className={BUTTON}>
        {phase === "sending" ? "Enviando…" : "Suscribirme gratis"}
      </button>
      <p className="text-xs text-[var(--site-color-muted-foreground)]">Sin contraseña: te enviamos un enlace a tu correo para entrar. Puedes pedir otro cuando quieras.</p>
    </form>
  );
}
