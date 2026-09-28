import { ApiError } from "./api-client";

/**
 * Mensaje para un error del asistente de IA, reconocido por estado y código — nunca interpretando
 * el texto del servidor. El 402 (cuota del plan) lo muestra `PlanLimitNotice`; acá devuelve `null`.
 */
export function aiErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) {
    return error ? "No pudimos conectar con el asistente. Revisa tu conexión e intenta de nuevo." : null;
  }
  const code = (error.body as { code?: unknown } | undefined)?.code;
  switch (error.status) {
    case 402:
      return null;
    case 429:
      return "Hiciste muchas solicitudes seguidas. Espera un minuto y vuelve a intentarlo.";
    case 503:
      return "El asistente no está disponible en este momento. Intenta más tarde.";
    case 502:
      return "El asistente no encontró una versión mejor. Prueba otra vez o con otra indicación.";
    case 422:
      return code === "AI_CONTENT_TOO_LONG"
        ? "Este bloque tiene demasiado texto para traducirlo de una vez. Divídelo en bloques más cortos."
        : typeof (error.body as { message?: unknown } | undefined)?.message === "string"
          ? ((error.body as { message: string }).message)
          : "El asistente no puede trabajar con este bloque.";
    case 403:
      return "Tu rol no permite editar esta página.";
    default:
      return "Algo salió mal al pedir propuestas. Intenta de nuevo.";
  }
}

/** Vista previa en texto plano de un texto enriquecido (solo para leer; nunca se inyecta como HTML). */
export function plainPreview(html: string): string {
  return html
    .replace(/<\/(p|li|h[1-6])>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
