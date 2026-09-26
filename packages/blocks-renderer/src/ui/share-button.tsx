"use client";

import { Check, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Status = "idle" | "copied" | "failed";

const STATUS_TEXT: Record<Exclude<Status, "idle">, string> = {
  copied: "Enlace copiado",
  failed: "No se pudo copiar el enlace",
};

/**
 * Compartir desde la página pública (PL8). Con la hoja de compartir del teléfono si existe
 * (`navigator.share`); si no, copia el enlace y lo anuncia en una región `aria-live`. Nunca abre
 * una ventana que bloquee ni navega. Sin `url`, comparte la página en la que está.
 *
 * Es un `<button>` hermano del enlace, nunca dentro de él: un control, un destino.
 */
export function ShareButton({
  url,
  title,
  label,
  className = "",
}: {
  /** Destino a compartir; sin él, la dirección de la página actual. */
  url?: string;
  title: string;
  /** Nombre accesible del botón ("Compartir Mi portafolio"). */
  label: string;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function show(next: Exclude<Status, "idle">) {
    setStatus(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  }

  async function share() {
    const target = url ? new URL(url, window.location.href).toString() : window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url: target });
        return;
      } catch (error) {
        // Cerrar la hoja de compartir no es un error; cualquier otro fallo cae a copiar.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(target);
      show("copied");
    } catch {
      show("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={share}
        aria-label={label}
        data-share-button=""
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--site-radius)] transition-opacity hover:opacity-80 motion-reduce:transition-none ${className}`}
      >
        {status === "copied" ? <Check className="h-5 w-5" aria-hidden="true" /> : <Share2 className="h-5 w-5" aria-hidden="true" />}
      </button>
      <span role="status" aria-live="polite" className="sr-only" data-share-status="">
        {status === "idle" ? "" : STATUS_TEXT[status]}
      </span>
    </>
  );
}
