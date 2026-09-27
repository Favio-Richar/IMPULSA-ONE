"use client";

import type { ReactNode } from "react";

// Piezas compartidas por los flujos que se despliegan desde un botón de la pila: reservar (F5.2) y
// pedir un producto (F5.5). Colores siempre del tema (pares verificados AA).

export const INPUT_CLASS =
  "w-full rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2 text-sm text-[var(--site-color-foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-color-primary)]";
export const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)] disabled:cursor-not-allowed disabled:opacity-50";
export const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-4 py-2.5 text-sm font-medium text-[var(--site-color-foreground)]";

/** GET/POST a una ruta local de `apps/web`; un error trae el motivo más concreto que haya. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const response = await fetch(url, init);
    const body = (await response.json().catch(() => null)) as { message?: unknown; issues?: Array<{ message?: unknown }> } | null;
    if (!response.ok) {
      // Un 400 trae el motivo concreto en `issues`: mejor que el "revisa los datos" genérico.
      const detail = body?.issues?.[0]?.message;
      const message = typeof detail === "string" ? detail : typeof body?.message === "string" ? body.message : "Ocurrió un error. Intenta de nuevo.";
      return { ok: false, status: response.status, message };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, message: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo." };
  }
}

export function Notice({ children }: { children: ReactNode }) {
  // Texto del tema sobre la superficie (par verificado AA), con un borde que lo separa: no un rojo
  // fijo, que podría no leerse sobre un tema oscuro.
  return (
    <p role="alert" className="rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2 text-sm text-[var(--site-color-foreground)]">
      {children}
    </p>
  );
}
