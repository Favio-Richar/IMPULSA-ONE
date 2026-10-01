import { ApiError } from "./api-client";

const KNOWN_CODES = new Set([
  "PAGE_CAMPAIGN_PAGE_INVALID",
  "PAGE_CAMPAIGN_OVERLAP",
  "HOME_TAKEOVER_OVERLAP",
  "PAGE_CAMPAIGN_LIMIT_REACHED",
  "PAGE_CAMPAIGN_CLOSED",
  "PAGE_CAMPAIGN_WINDOW_INVALID",
]);

/**
 * Mensaje de un error al guardar, cancelar o borrar una campaña (F7.7, ADR-022), por estado y
 * código, nunca interpretando el texto. Los códigos propios traen un mensaje ya pensado para el
 * usuario desde la API (en español, sin detalles internos), así que se muestra tal cual.
 */
export function pageCampaignErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) {
    return error ? "No pudimos conectar. Revisa tu conexión e intenta de nuevo." : null;
  }
  const body = error.body as { code?: unknown; message?: unknown } | undefined;
  if (typeof body?.code === "string" && KNOWN_CODES.has(body.code) && typeof body.message === "string") {
    return body.message;
  }
  if (error.status === 403) {
    return "Tu rol no permite cambiar las campañas de este sitio.";
  }
  if (error.status === 404) {
    return "La campaña ya no existe. Recarga la página.";
  }
  if (error.status === 422) {
    return "Revisa los datos de la campaña.";
  }
  return "Algo salió mal. Intenta de nuevo.";
}

const DATE_TIME = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });

/** Fecha y hora local del navegador ("1 oct 2026, 09:00"). */
export function formatCampaignDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

/** Cuánto falta, legible y sin segundos: "en 3 días", "en 5 h 20 min", "en 12 min". */
export function formatRemaining(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const days = Math.floor(hours / 24);
  return `${days} días`;
}

/** `<input type="datetime-local">` usa hora local sin zona: ISO ↔ "YYYY-MM-DDTHH:mm". */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** La inversa: devuelve `null` si el campo está vacío o no es una fecha válida. */
export function localInputToIso(value: string): string | null {
  if (value.trim() === "") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
