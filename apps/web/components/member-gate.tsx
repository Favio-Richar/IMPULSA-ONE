"use client";

import { useState } from "react";

type Phase = "idle" | "sending" | "sent";

/**
 * Puerta de una página «solo para miembros» (F10.1). No hay contraseña: el miembro pide un enlace a su correo. La respuesta es la
 * misma para cualquier correo, así que el mensaje de éxito no confirma que la persona sea miembro.
 */
export function MemberGate({ siteSlug, siteName }: { siteSlug: string; siteName: string }) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "sending") return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Escribe un correo válido.");
      return;
    }
    setPhase("sending");
    setError(null);
    try {
      const response = await fetch(`/api/members/access/${encodeURIComponent(siteSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (response.ok) {
        setPhase("sent");
        return;
      }
      setError(response.status === 429 ? "Pediste varios enlaces seguidos. Espera unos minutos e intenta de nuevo." : "No pudimos enviar el enlace ahora. Intenta de nuevo en un momento.");
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    }
    setPhase("idle");
  }

  return (
    <section
      aria-labelledby="miembros-titulo"
      className="mx-auto my-12 w-full max-w-md rounded-xl border border-[var(--site-color-border)] bg-[var(--site-color-background)] p-6 shadow-sm sm:p-8"
    >
      <h1 id="miembros-titulo" className="text-xl font-semibold text-[var(--site-color-foreground)]">
        Contenido para miembros
      </h1>
      {phase === "sent" ? (
        <p role="status" className="mt-3 text-sm leading-relaxed text-[var(--site-color-foreground)]">
          Si <span className="font-medium">{email.trim()}</span> es miembro de {siteName}, te enviamos un enlace para entrar. Vence en 15 minutos y sirve una sola vez.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-relaxed text-[var(--site-color-muted-foreground)]">
            Esta página es solo para miembros de {siteName}. Escribe tu correo y te enviaremos un enlace para entrar, sin contraseña.
          </p>
          <form noValidate onSubmit={submit} className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="miembro-correo" className="text-sm font-medium text-[var(--site-color-foreground)]">
                Tu correo
              </label>
              <input
                id="miembro-correo"
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "miembro-correo-error" : undefined}
                className="min-h-11 w-full rounded-lg border border-[var(--site-color-border)] bg-transparent px-3 py-2 text-sm text-[var(--site-color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2"
              />
              {error ? (
                <p id="miembro-correo-error" role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={phase === "sending"}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
            >
              {phase === "sending" ? "Enviando…" : "Enviarme el enlace"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
