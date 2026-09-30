import type { WebhookDeliveryResponse, WebhookEndpointResponse } from "@impulza/contracts";
import { WEBHOOK_EVENT_LABELS, type WebhookEventType } from "@impulza/validation";

// Textos del panel de Integraciones (F7.2): lo técnico del registro de entregas en palabras que
// entiende el dueño de un negocio, sin esconder el dato (código y motivo siguen visibles).

export const DELIVERY_STATUS_LABELS: Record<WebhookDeliveryResponse["status"], string> = {
  PENDING: "En curso",
  SUCCEEDED: "Entregado",
  FAILED: "Falló",
  SKIPPED: "Omitido",
};

/** Nombre de un evento (incluye `ping` y tipos desconocidos, sin romper). */
export function eventLabel(eventType: string): string {
  if (eventType === "ping") return "Prueba";
  return WEBHOOK_EVENT_LABELS[eventType as WebhookEventType]?.label ?? eventType;
}

/** Por qué falló el último intento, en una frase. `null` si no hubo error. */
export function deliveryErrorText(delivery: Pick<WebhookDeliveryResponse, "lastError" | "lastStatusCode">): string | null {
  const error = delivery.lastError;
  if (!error) return null;
  if (error.startsWith("http_")) {
    const code = delivery.lastStatusCode ?? Number(error.slice(5));
    if (code === 410) return "El destino respondió que ya no existe (410).";
    if (code === 401 || code === 403) return `El destino rechazó el envío (${code}). Revisa si pide autenticación.`;
    if (code === 404) return "El destino respondió que esa URL no existe (404).";
    if (code === 429) return "El destino pidió esperar (429): demasiados envíos.";
    if (code >= 500) return `El destino tuvo un error propio (${code}).`;
    return `El destino respondió con error ${code}.`;
  }
  const known: Record<string, string> = {
    timeout: "El destino no respondió en 10 segundos.",
    redirect_not_followed: "El destino respondió con una redirección. Por seguridad no las seguimos: usa la URL final.",
    unsafe_destination: "La URL apunta a una red privada o local. Solo se envía a direcciones públicas.",
    insecure_url: "La URL no usa https.",
    invalid_url: "La URL no es válida.",
    ENOTFOUND: "No encontramos ese dominio. Revisa que la URL esté bien escrita.",
    EAI_AGAIN: "No pudimos resolver el dominio en ese momento.",
    ECONNREFUSED: "El servidor de destino rechazó la conexión.",
    ECONNRESET: "El servidor de destino cortó la conexión.",
    CERT_HAS_EXPIRED: "El certificado https del destino está vencido.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "El certificado https del destino no es de confianza.",
    ERR_TLS_CERT_ALTNAME_INVALID: "El certificado https del destino no corresponde a su dominio.",
  };
  return known[error] ?? `Error de conexión (${error}).`;
}

export type EndpointHealth = { tone: "success" | "warning" | "danger" | "muted"; label: string; detail: string | null };

/** Estado de un destino para la insignia y su explicación. */
export function endpointHealth(endpoint: Pick<WebhookEndpointResponse, "active" | "disabledReason" | "consecutiveFailures">): EndpointHealth {
  if (!endpoint.active) {
    if (endpoint.disabledReason === "gone") {
      return { tone: "danger", label: "Desactivado", detail: "El destino respondió que ya no existe (410). Corrige la URL y reanúdalo." };
    }
    if (endpoint.disabledReason === "too_many_failures") {
      return { tone: "danger", label: "Desactivado", detail: "Falló en 15 entregas seguidas. Revisa el registro, corrige el destino y reanúdalo." };
    }
    return { tone: "muted", label: "Pausado", detail: null };
  }
  if (endpoint.consecutiveFailures > 0) {
    return {
      tone: "warning",
      label: "Con fallas",
      detail: `${endpoint.consecutiveFailures} ${endpoint.consecutiveFailures === 1 ? "entrega fallida" : "entregas fallidas"} seguidas. A las 15 se desactiva solo.`,
    };
  }
  return { tone: "success", label: "Activo", detail: null };
}

/** URL para mostrar: el host completo y la ruta recortada al medio (puede llevar un token largo). */
export function displayUrl(url: string, max = 48): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    const short = path.length > max ? `${path.slice(0, Math.ceil(max / 2) - 1)}…${path.slice(-Math.floor(max / 2) + 1)}` : path;
    return { host: parsed.host, path: short === "/" ? "" : short };
  } catch {
    return { host: url, path: "" };
  }
}
