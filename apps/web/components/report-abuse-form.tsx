"use client";

import {
  ABUSE_REPORT_DETAILS_MAX,
  ABUSE_REPORT_OTHER_DETAILS_MIN,
  ABUSE_REPORT_REASONS,
  ABUSE_REPORT_REASON_LABELS,
  type AbuseReportReason,
} from "@impulza/validation";
import { useRef, useState } from "react";

type Phase = "idle" | "sending" | "sent";

/** Mensajes para el visitante según la respuesta; nunca se muestra texto crudo del servidor salvo el de validación. */
function messageFor(status: number, serverMessage?: string): string {
  if (status === 429) return "Enviaste varios reportes seguidos. Espera unos minutos y vuelve a intentarlo.";
  if (status === 404) return "Esta página ya no está disponible, así que no hace falta reportarla.";
  if (status === 400) return serverMessage ?? "Revisa los datos del formulario.";
  return "No pudimos enviar el reporte ahora. Intenta de nuevo en un momento.";
}

/**
 * Formulario de reporte de abuso (F9.9d). Sin cuenta ni datos obligatorios: un motivo, un texto opcional y un correo
 * opcional que solo ve el equipo. La validación real es la del servidor; acá solo se adelanta para dar feedback.
 */
export function ReportAbuseForm({ siteSlug, siteName }: { siteSlug: string; siteName: string }) {
  const [reason, setReason] = useState<AbuseReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ reason?: string; details?: string; email?: string }>({});
  const doneRef = useRef<HTMLHeadingElement>(null);

  function validate(): boolean {
    const next: typeof fieldErrors = {};
    if (!reason) next.reason = "Elige un motivo.";
    if (reason === "OTHER" && details.trim().length < ABUSE_REPORT_OTHER_DETAILS_MIN) {
      next.details = `Cuéntanos qué pasa (al menos ${ABUSE_REPORT_OTHER_DETAILS_MIN} caracteres).`;
    }
    if (email.trim().length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Escribe un correo válido o déjalo vacío.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "sending" || !validate()) return;
    setPhase("sending");
    setError(null);
    try {
      const body: Record<string, string> = { reason: reason as string };
      if (details.trim().length > 0) body.details = details.trim();
      if (email.trim().length > 0) body.email = email.trim();
      const response = await fetch(`/api/abuse-reports/${encodeURIComponent(siteSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        setPhase("sent");
        requestAnimationFrame(() => doneRef.current?.focus());
        return;
      }
      const payload = (await response.json().catch(() => null)) as { message?: string; issues?: Array<{ message: string }> } | null;
      setError(messageFor(response.status, payload?.issues?.[0]?.message ?? payload?.message));
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    }
    setPhase("idle");
  }

  if (phase === "sent") {
    return (
      <section role="status" className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="reporte-enviado">
        <h1 id="reporte-enviado" ref={doneRef} tabIndex={-1} className="text-xl font-semibold text-slate-900 outline-none">
          Gracias, recibimos tu reporte
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-700">
          Una persona del equipo lo revisará. Ninguna página se despublica de forma automática: cada decisión se toma con revisión humana y queda registrada.
        </p>
      </section>
    );
  }

  const remaining = ABUSE_REPORT_DETAILS_MAX - details.length;

  return (
    <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="reportar-titulo">
      <h1 id="reportar-titulo" className="text-xl font-semibold text-slate-900">
        Reportar esta página
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        Vas a reportar <span className="font-medium">{siteName}</span>. No necesitas una cuenta. Tu reporte lo revisa una persona del equipo de Impulza One.
      </p>

      <form noValidate onSubmit={submit} className="mt-6 flex flex-col gap-5">
        <fieldset aria-describedby={fieldErrors.reason ? "motivo-error" : undefined}>
          <legend className="text-sm font-medium text-slate-900">¿Qué ocurre?</legend>
          <div className="mt-2 flex flex-col gap-2">
            {ABUSE_REPORT_REASONS.map((value) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 has-[:checked]:border-slate-900">
                <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="size-4" />
                {ABUSE_REPORT_REASON_LABELS[value]}
              </label>
            ))}
          </div>
          {fieldErrors.reason ? (
            <p id="motivo-error" role="alert" className="mt-2 text-sm text-red-700">
              {fieldErrors.reason}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reporte-detalle" className="text-sm font-medium text-slate-900">
            Cuéntanos más {reason === "OTHER" ? "" : <span className="font-normal text-slate-600">(opcional)</span>}
          </label>
          <textarea
            id="reporte-detalle"
            rows={4}
            maxLength={ABUSE_REPORT_DETAILS_MAX}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            aria-invalid={fieldErrors.details ? true : undefined}
            aria-describedby="reporte-detalle-ayuda"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          />
          <p id="reporte-detalle-ayuda" className={fieldErrors.details ? "text-sm text-red-700" : "text-xs text-slate-600"}>
            {fieldErrors.details ?? `Texto plano, hasta ${ABUSE_REPORT_DETAILS_MAX} caracteres (${remaining} restantes). No incluyas datos personales de terceros.`}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reporte-correo" className="text-sm font-medium text-slate-900">
            Tu correo <span className="font-normal text-slate-600">(opcional)</span>
          </label>
          <input
            id="reporte-correo"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby="reporte-correo-ayuda"
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          />
          <p id="reporte-correo-ayuda" className={fieldErrors.email ? "text-sm text-red-700" : "text-xs text-slate-600"}>
            {fieldErrors.email ?? "Solo para que el equipo pueda pedirte más contexto. Nunca se le muestra al dueño de la página."}
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={phase === "sending"}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60"
        >
          {phase === "sending" ? "Enviando…" : "Enviar reporte"}
        </button>
      </form>
    </section>
  );
}
