"use client";

import type { PublicMembershipPlanResponse } from "@impulza/contracts";
import { MEMBERSHIP_PERIOD_LABELS, MEMBERSHIP_PROVIDER_LABELS, type MembershipCheckoutProvider } from "@impulza/validation";
import { useState } from "react";
import { formatPlanPrice } from "../lib/plan-price";

type Phase = "idle" | "sending" | "sent";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Puerta de una página «solo para miembros» (F10.1) y, si el negocio vende membresías, su compra (F10.2). No hay contraseña: el
 * miembro pide un enlace a su correo. La respuesta es la misma para cualquier correo, así que el mensaje de éxito no confirma que
 * la persona sea miembro. `inactive` = tiene sesión pero su periodo pagado terminó: se le ofrece renovar.
 */
export function MemberGate({
  siteSlug,
  siteName,
  plans = [],
  providers = [],
  inactive = false,
}: {
  siteSlug: string;
  siteName: string;
  plans?: PublicMembershipPlanResponse[];
  /** Medios de pago que el negocio tiene conectados. */
  providers?: MembershipCheckoutProvider[];
  inactive?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "sending") return;
    if (!EMAIL_PATTERN.test(email.trim())) {
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
      className="mx-auto my-12 flex w-full max-w-md flex-col gap-8 rounded-xl border border-[var(--site-color-border)] bg-[var(--site-color-background)] p-6 shadow-sm sm:p-8"
    >
      <div>
        <h1 id="miembros-titulo" className="text-xl font-semibold text-[var(--site-color-foreground)]">
          {inactive ? "Tu membresía no está vigente" : "Contenido para miembros"}
        </h1>
        {phase === "sent" ? (
          <p role="status" className="mt-3 text-sm leading-relaxed text-[var(--site-color-foreground)]">
            Si <span className="font-medium">{email.trim()}</span> es miembro de {siteName}, te enviamos un enlace para entrar. Vence en 15 minutos y sirve una sola vez.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm leading-relaxed text-[var(--site-color-muted-foreground)]">
              {inactive
                ? `Tu periodo en ${siteName} terminó. Renueva abajo para volver a entrar, o pide un enlace nuevo si ya renovaste.`
                : `Esta página es solo para miembros de ${siteName}. Si ya eres miembro, escribe tu correo y te enviaremos un enlace para entrar, sin contraseña.`}
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
      </div>

      {plans.length > 0 && providers.length > 0 ? <PlanList siteSlug={siteSlug} plans={plans} providers={providers} renew={inactive} /> : null}
    </section>
  );
}

/**
 * Mercado Pago se abre con un GET; Webpay Plus exige un POST con el token (`token_ws`): se arma un formulario efímero y se envía. El
 * comprador sale del sitio hacia la pasarela; al volver lo recibe «Tu membresía».
 */
function goToCheckout(url: string, method: "GET" | "POST", fields: Record<string, string>): void {
  if (method === "GET") {
    window.location.assign(url);
    return;
  }
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

function PlanList({
  siteSlug,
  plans,
  providers,
  renew,
}: {
  siteSlug: string;
  plans: PublicMembershipPlanResponse[];
  providers: MembershipCheckoutProvider[];
  renew: boolean;
}) {
  const [provider, setProvider] = useState<MembershipCheckoutProvider>(providers[0] ?? "MERCADO_PAGO");
  const [selected, setSelected] = useState<string | null>(plans.length === 1 ? (plans[0]?.id ?? null) : null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!selected) {
      setError("Elige un plan.");
      return;
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Escribe un correo válido.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body: Record<string, string> = { email: email.trim(), provider };
      if (name.trim().length > 0) body.name = name.trim();
      const response = await fetch(`/api/members/checkout/${encodeURIComponent(siteSlug)}/${encodeURIComponent(selected)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as {
        checkoutUrl?: string;
        method?: "GET" | "POST";
        fields?: Record<string, string>;
        message?: string;
      } | null;
      if (response.ok && payload?.checkoutUrl) {
        goToCheckout(payload.checkoutUrl, payload.method === "POST" ? "POST" : "GET", payload.fields ?? {});
        return;
      }
      setError(payload?.message ?? "No pudimos iniciar el pago. Intenta de nuevo en un momento.");
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    }
    setPending(false);
  }

  return (
    <form noValidate onSubmit={pay} aria-labelledby="planes-titulo" className="flex flex-col gap-4 border-t border-[var(--site-color-border)] pt-6">
      <h2 id="planes-titulo" className="text-base font-semibold text-[var(--site-color-foreground)]">
        {renew ? "Renovar tu membresía" : "Hazte miembro"}
      </h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Plan</legend>
        {plans.map((plan) => (
          <label
            key={plan.id}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-[var(--site-color-border)] p-3 text-sm text-[var(--site-color-foreground)] has-[:checked]:border-[var(--site-color-primary)]"
          >
            <input type="radio" name="plan" value={plan.id} checked={selected === plan.id} onChange={() => setSelected(plan.id)} className="mt-1 size-4" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                {plan.name} · {formatPlanPrice(plan.priceAmount, plan.priceCurrency)} {MEMBERSHIP_PERIOD_LABELS[plan.period]}
              </span>
              {plan.description ? <span className="text-[var(--site-color-muted-foreground)]">{plan.description}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      {providers.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-[var(--site-color-foreground)]">¿Cómo quieres pagar?</legend>
          {providers.map((option) => (
            <label key={option} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--site-color-border)] p-3 text-sm text-[var(--site-color-foreground)] has-[:checked]:border-[var(--site-color-primary)]">
              <input type="radio" name="medio" value={option} checked={provider === option} onChange={() => setProvider(option)} className="size-4" />
              {MEMBERSHIP_PROVIDER_LABELS[option]}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="compra-correo" className="text-sm font-medium text-[var(--site-color-foreground)]">
          Tu correo
        </label>
        <input
          id="compra-correo"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="min-h-11 w-full rounded-lg border border-[var(--site-color-border)] bg-transparent px-3 py-2 text-sm text-[var(--site-color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="compra-nombre" className="text-sm font-medium text-[var(--site-color-foreground)]">
          Tu nombre <span className="font-normal text-[var(--site-color-muted-foreground)]">(opcional)</span>
        </label>
        <input
          id="compra-nombre"
          autoComplete="name"
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-h-11 w-full rounded-lg border border-[var(--site-color-border)] bg-transparent px-3 py-2 text-sm text-[var(--site-color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
      >
        {pending ? "Un momento…" : `Pagar con ${provider === "WEBPAY_PLUS" ? "Webpay" : "Mercado Pago"}`}
      </button>
      <p className="text-xs text-[var(--site-color-muted-foreground)]">
        El pago es por un periodo y no se renueva solo: puedes renovar cuando quieras y los días se suman. El dinero va directo a la cuenta del negocio; la plataforma de pago no entrega tu tarjeta a este sitio.
      </p>
    </form>
  );
}
