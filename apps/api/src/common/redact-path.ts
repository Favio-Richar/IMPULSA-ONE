/**
 * Quita de una ruta los secretos que viajan en la URL antes de escribirla en logs o enviarla a
 * Sentry. Hoy: el token del feed iCal (`/public/bookings/calendar-feed/<token>.ics`), que da acceso a
 * los datos de los clientes de un sitio. Agregar aquí cualquier ruta futura con un secreto en el path.
 */
export function redactPath(path: string | undefined): string | undefined {
  return path?.replace(/(\/calendar-feed\/)[^/?#]+(\.ics)/g, "$1[redactado]$2");
}
