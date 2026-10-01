"use client";

import { Mail, MailCheck } from "lucide-react";
import { NEWSLETTER_CONSENT_LABEL, NEWSLETTER_HONEYPOT_FIELD, type NewsletterBlockConfig } from "@impulza/validation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { emitConversion } from "../lib/conversions.js";
import { stackSurfaceClass } from "../ui/stack-button.js";

const INPUT_CLASS =
  "w-full min-h-11 rounded-[calc(var(--site-radius)/1.5)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2 text-sm text-[var(--site-color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-color-primary)]";

type Status = "idle" | "submitting" | "sent" | "error";

/**
 * Suscripción a la newsletter con doble confirmación (F7.4, ADR-019): correo (y nombre si se pidió),
 * la casilla de consentimiento fija y no premarcada, y un campo trampa invisible. Al enviar, la
 * persona recibe un enlace para confirmar; hasta entonces no queda suscrita. En la vista previa del
 * constructor no envía nada.
 */
export function NewsletterBlock({
  config,
  siteSlug,
  mode = "public",
  glass = false,
}: {
  config: NewsletterBlockConfig;
  siteSlug?: string;
  mode?: "public" | "preview";
  glass?: boolean;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<{ field: "email" | "consent" | "form"; message: string } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const canSubmit = mode === "public" && Boolean(siteSlug);

  // Foco en el resultado después de pintarlo, para que el lector de pantalla lo anuncie.
  useEffect(() => {
    if (status === "sent") statusRef.current?.focus();
  }, [status]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit || !siteSlug) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError({ field: "email", message: "Escribe un correo válido, por ejemplo nombre@correo.cl." });
      return;
    }
    if (!consent) {
      setError({ field: "consent", message: "Marca la casilla para confirmar que quieres recibir correos." });
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      const response = await fetch(`/api/newsletter/${encodeURIComponent(siteSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one" },
        body: JSON.stringify({
          email: email.trim(),
          ...(config.askName && name.trim() ? { name: name.trim() } : {}),
          consent: true,
          [NEWSLETTER_HONEYPOT_FIELD]: trap,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string; issues?: Array<{ path: string; message: string }> } | null;
        const issue = body?.issues?.[0];
        setError(
          issue?.path === "email"
            ? { field: "email", message: issue.message }
            : { field: "form", message: response.status === 429 ? "Hiciste muchos intentos seguidos. Espera unos minutos." : (body?.message ?? "No pudimos registrar tu suscripción. Intenta de nuevo.") },
        );
        setStatus("error");
        return;
      }
      setStatus("sent");
      emitConversion({ kind: "newsletter_signup" });
    } catch {
      setError({ field: "form", message: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo." });
      setStatus("error");
    }
  }

  const surface = stackSurfaceClass(glass ? "glass" : "secondary");
  const emailId = `${id}-email`;
  const nameId = `${id}-name`;
  const consentId = `${id}-consent`;
  const errorId = `${id}-error`;

  return (
    <section className={`flex flex-col gap-4 p-5 ${surface}`} aria-labelledby={`${id}-title`} data-newsletter="">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]">
          {status === "sent" ? <MailCheck className="h-5 w-5" aria-hidden="true" /> : <Mail className="h-5 w-5" aria-hidden="true" />}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={`${id}-title`} className="font-semibold text-[var(--site-color-foreground)]">
            {config.title ?? "Recibe nuestras novedades"}
          </h2>
          {config.description ? <p className="text-sm text-[var(--site-color-muted-foreground)]">{config.description}</p> : null}
        </div>
      </div>

      {status === "sent" ? (
        <div ref={statusRef} tabIndex={-1} role="status" className="flex flex-col gap-1 rounded-[calc(var(--site-radius)/1.5)] border border-[var(--site-color-border)] p-4 outline-none" data-newsletter-sent="">
          <p className="font-medium text-[var(--site-color-foreground)]">Revisa tu correo</p>
          <p className="text-sm text-[var(--site-color-muted-foreground)]">
            {config.successMessage ?? "Te enviamos un enlace para confirmar tu suscripción."} Si no lo ves, busca en spam o promociones. El enlace vale 48 horas.
          </p>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={submit} noValidate aria-describedby={error ? errorId : undefined}>
          {config.askName ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={nameId} className="text-sm font-medium text-[var(--site-color-foreground)]">
                Nombre <span className="font-normal text-[var(--site-color-muted-foreground)]">(opcional)</span>
              </label>
              <input id={nameId} className={INPUT_CLASS} type="text" autoComplete="given-name" maxLength={120} disabled={!canSubmit} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <label htmlFor={emailId} className="text-sm font-medium text-[var(--site-color-foreground)]">
              Correo
            </label>
            <input
              id={emailId}
              className={INPUT_CLASS}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              maxLength={320}
              disabled={!canSubmit}
              aria-invalid={error?.field === "email" || undefined}
              aria-describedby={error?.field === "email" ? errorId : undefined}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error?.field === "email") setError(null);
              }}
            />
          </div>
          {/* Campo trampa: fuera de la vista y del orden de tabulación; una persona nunca lo llena. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label htmlFor={`${id}-${NEWSLETTER_HONEYPOT_FIELD}`}>Sitio web</label>
            <input id={`${id}-${NEWSLETTER_HONEYPOT_FIELD}`} type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(event) => setTrap(event.target.value)} />
          </div>
          <label htmlFor={consentId} className="flex items-start gap-2.5 text-sm text-[var(--site-color-foreground)]">
            <input
              id={consentId}
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--site-color-primary)]"
              disabled={!canSubmit}
              checked={consent}
              aria-invalid={error?.field === "consent" || undefined}
              onChange={(event) => {
                setConsent(event.target.checked);
                if (error?.field === "consent") setError(null);
              }}
            />
            <span>{NEWSLETTER_CONSENT_LABEL}</span>
          </label>
          {error ? (
            <p id={errorId} role="alert" className="text-sm font-medium text-[var(--site-color-foreground)]">
              <span aria-hidden="true">⚠ </span>
              {error.message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!canSubmit || status === "submitting"}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-[calc(var(--site-radius)/1.5)] bg-[var(--site-color-primary)] px-5 text-sm font-semibold text-[var(--site-color-primary-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
          >
            {status === "submitting" ? "Enviando…" : config.buttonLabel}
          </button>
          {mode === "preview" ? <p className="text-center text-xs text-[var(--site-color-muted-foreground)]">Vista previa: el formulario se envía en la página publicada.</p> : null}
        </form>
      )}
    </section>
  );
}
