"use client";

import { MessageSquareText } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import type { PublicFormResponse } from "@impulza/contracts";
import type { ContactFormBlockConfig } from "@impulza/validation";
import { StackButtonContent, stackButtonClass } from "../ui/stack-button.js";
import { SURFACE_SCOPE } from "../ui/surface.js";

type Status = "idle" | "submitting" | "success" | "error";

const INPUT_CLASS =
  "w-full rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2 text-sm text-[var(--site-color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-color-primary)]";

/**
 * F3.2: el bloque ya no declara sus propios campos (v1, F2.4) — resuelve un `Form` real por
 * `formId`. `form` llega ya resuelto por quien renderiza la página (`apps/web`, F2.7): este
 * componente no sabe hablar con `apps/api` directamente ni conoce su URL — es puramente
 * presentacional salvo por el propio envío, que hace a través de la ruta local de `apps/web`
 * (`app/api/forms/.../submissions`), nunca contra `apps/api` desde el navegador (mismo principio
 * que el resto de `apps/web`: sin lógica de negocio ni llamadas directas a la API en el cliente).
 *
 * `mode="preview"` (constructor, F2.9) no envía nada de verdad: muestra los campos reales para que
 * el usuario vea qué va a publicar, con el botón deshabilitado y un aviso explícito — igual
 * criterio que la v1 de este bloque, pero ahora con datos reales en vez de una lista fija.
 */
export function ContactFormBlock({
  config,
  form,
  siteSlug,
  mode = "public",
  primary = false,
  glass = false,
}: {
  config: ContactFormBlockConfig;
  form: PublicFormResponse | null;
  siteSlug?: string;
  mode?: "public" | "preview";
  /** Acción principal de la página (PP5): el botón que despliega el formulario va destacado. */
  primary?: boolean;
  /** Tema "glass" (PL5): el botón plegado, translúcido como el resto de los secundarios. */
  glass?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [ack, setAck] = useState<{ message: string; redirectUrl?: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!config.formId) {
    return (
      <div className={`${SURFACE_SCOPE} rounded-[var(--site-radius)] border border-dashed border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-6 text-sm text-[var(--site-color-muted-foreground)]`}>
        {config.title ? <p className="mb-2 font-medium text-[var(--site-color-foreground)]">{config.title}</p> : null}
        Este bloque todavía no tiene un formulario elegido.
      </div>
    );
  }

  if (!form) {
    // Distinto del caso de arriba: sí hay un formulario elegido, pero acá no llegó su definición
    // resuelta — en el constructor (mode="preview") es la simplificación esperada (F3.2: la vista
    // previa no pide los datos reales del formulario), no un error; en el sitio público sí sería
    // un formulario borrado después de elegirlo.
    return (
      <div className={`${SURFACE_SCOPE} rounded-[var(--site-radius)] border border-dashed border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-6 text-sm text-[var(--site-color-muted-foreground)]`}>
        {config.title ? <p className="mb-2 font-medium text-[var(--site-color-foreground)]">{config.title}</p> : null}
        {mode === "preview"
          ? "Formulario elegido — se mostrará con sus campos reales en el sitio publicado."
          : "Este formulario ya no existe."}
      </div>
    );
  }

  const canSubmit = mode === "public" && Boolean(siteSlug);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit || !form || !siteSlug) {
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(siteSlug)}/${form.id}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setErrorMessage(body?.message ?? "No se pudo enviar el formulario. Intenta de nuevo.");
        setStatus("error");
        return;
      }

      const data = (await response.json()) as { message: string; redirectUrl?: string };
      setAck(data);
      setStatus("success");
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    } catch {
      setErrorMessage("No se pudo enviar el formulario. Revisa tu conexión e intenta de nuevo.");
      setStatus("error");
    }
  }

  const panelClass = `${SURFACE_SCOPE} mt-3 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-6 shadow-[var(--site-shadow)]`;

  // PP8: en la página de enlaces, el formulario es un botón más de la pila ("Reserva tu mesa") que
  // se despliega al tocarlo. `<details>` es nativo: funciona con teclado y lector de pantalla y sin
  // JavaScript. La barra de acción principal (PP5) lo abre al llevar hasta él.
  return (
    <details className="group" open={status === "success" ? true : undefined}>
      <summary className={`${stackButtonClass(primary ? "primary" : glass ? "glass" : "secondary", primary)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        <StackButtonContent
          primary={primary}
          icon={<MessageSquareText className="h-5 w-5 shrink-0" aria-hidden="true" />}
          label={config.title ?? "Escríbenos"}
        />
      </summary>
      {status === "success" && ack ? (
        <div className={panelClass}>
          <p className="text-sm text-[var(--site-color-foreground)]">{ack.message}</p>
        </div>
      ) : (
    <form
      className={panelClass}
      onSubmit={handleSubmit}
      noValidate
    >

      <div className="flex flex-col gap-3">
        {form.fields.map((field) => (
          <div key={field.id}>
            {field.type !== "CHECKBOX" && field.type !== "CONSENT" ? (
              <label className="mb-1 block text-sm font-medium text-[var(--site-color-foreground)]" htmlFor={field.id}>
                {field.label}
                {field.required ? " *" : ""}
              </label>
            ) : null}

            {field.type === "CHECKBOX" || field.type === "CONSENT" ? (
              <label className="flex items-start gap-2 text-sm text-[var(--site-color-foreground)]">
                <input
                  id={field.id}
                  type="checkbox"
                  required={field.required}
                  disabled={!canSubmit}
                  checked={Boolean(values[field.id])}
                  onChange={(event) => setValues((prev) => ({ ...prev, [field.id]: event.target.checked }))}
                />
                <span>
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
              </label>
            ) : field.type === "TEXTAREA" ? (
              <textarea
                id={field.id}
                className={INPUT_CLASS}
                rows={4}
                required={field.required}
                disabled={!canSubmit}
                value={(values[field.id] as string | undefined) ?? ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.id]: event.target.value }))}
              />
            ) : field.type === "SELECT" ? (
              <select
                id={field.id}
                className={INPUT_CLASS}
                required={field.required}
                disabled={!canSubmit}
                value={(values[field.id] as string | undefined) ?? ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.id]: event.target.value }))}
              >
                <option value="" disabled>
                  Selecciona una opción
                </option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={field.id}
                className={INPUT_CLASS}
                type={field.type === "EMAIL" ? "email" : field.type === "PHONE" ? "tel" : field.type === "NUMBER" ? "number" : "text"}
                required={field.required}
                disabled={!canSubmit}
                value={(values[field.id] as string | undefined) ?? ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.id]: event.target.value }))}
              />
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={!canSubmit || status === "submitting"}
          className="inline-flex items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-medium text-[var(--site-color-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "submitting" ? "Enviando…" : "Enviar"}
        </button>

        {status === "error" && errorMessage ? (
          <p className="text-sm text-red-600" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {mode === "preview" ? (
          <p className="text-sm text-[var(--site-color-muted-foreground)]">
            Vista previa: los envíos no se guardan aquí. Así lo verá y podrá usarlo un visitante en el sitio publicado.
          </p>
        ) : null}
      </div>
    </form>
      )}
    </details>
  );
}
