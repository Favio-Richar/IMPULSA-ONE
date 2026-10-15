import { templateCodeSchema } from "@impulza/validation";

// Plantilla elegida en la galería pública (apps/web, `/plantillas/<código>`). El sitio comercial manda a la persona al panel con
// `?plantilla=<código>` (al registro si es nueva, a «Crear sitio» si ya tiene cuenta). Entre esa visita y el momento de elegir
// plantilla puede haber un registro, una verificación de correo en otra pestaña y un inicio de sesión: por eso se guarda en
// `localStorage` (mismo navegador, cualquier pestaña) y vence en una semana. Es solo una preferencia: si el código no existe en
// el catálogo, nadie la usa. Nunca se guarda nada que no sea un código con el formato de plantilla.

const KEY = "impulza-template-intent";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Stored {
  code: string;
  at: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Guarda la plantilla de `?plantilla=` si viene con un código válido. Devuelve el código guardado, o `null`. */
export function captureTemplateIntent(search: string, now = Date.now()): string | null {
  const raw = new URLSearchParams(search).get("plantilla");
  const parsed = templateCodeSchema.safeParse(raw ?? "");
  if (!parsed.success) return null;
  try {
    storage()?.setItem(KEY, JSON.stringify({ code: parsed.data, at: now } satisfies Stored));
  } catch {
    // Sin almacenamiento (modo privado estricto): la persona elige la plantilla a mano, como siempre.
  }
  return parsed.data;
}

/** La plantilla elegida y vigente, sin consumirla. */
export function peekTemplateIntent(now = Date.now()): string | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored>;
    const parsed = templateCodeSchema.safeParse(stored.code);
    if (!parsed.success || typeof stored.at !== "number" || now - stored.at > MAX_AGE_MS || now < stored.at) {
      storage()?.removeItem(KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function clearTemplateIntent(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nada que limpiar.
  }
}
