/**
 * Quita de una ruta los secretos que viajan en la URL antes de escribirla en logs o enviarla a
 * Sentry:
 * - Token del feed iCal (`/public/bookings/calendar-feed/<token>.ics`)
 * - Token de confirmación de newsletter (`/public/newsletter/<token>`)
 * - Token de baja de correo (`/public/unsubscribe/<token>`)
 * - Token de gestión de reserva (`/public/bookings/<token>[/cancel|/reschedule]`)
 * - Token de visualización de pedido (`/public/orders/<token>`)
 * - Token de descargas digitales (`/public/downloads/<token>[/url]`)
 * - Token del enlace compartido de un informe (`/public/reports/<token>[/csv]`, F9.8b)
 * - Parámetros de consulta sensibles (`token`, `code`, `secret`, `key`, `state`)
 */
export function redactPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path
    .replace(/(\/calendar-feed\/)[^/?#]+(\.ics)/g, "$1[redactado]$2")
    .replace(/(\/public\/newsletter\/)[^/?#]+/g, "$1[redactado]")
    .replace(/(\/public\/unsubscribe\/)[^/?#]+/g, "$1[redactado]")
    .replace(/(\/public\/bookings\/)(?!calendar-feed\/)[^/?#]+(?=[/?#]|$)/g, "$1[redactado]")
    .replace(/(\/public\/orders\/)[^/?#]+/g, "$1[redactado]")
    .replace(/(\/public\/downloads\/)[^/?#]+(?=[/?#]|$)/g, "$1[redactado]")
    .replace(/(\/public\/reports\/)[^/?#]+(?=[/?#]|$)/g, "$1[redactado]")
    .replace(/([?&](?:token|code|secret|key|state)=)[^&#]+/gi, "$1[redactado]");
}
