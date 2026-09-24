import { timingSafeEqual } from "node:crypto";
import { VISITOR_PROXY_HEADERS } from "@impulza/analytics";
import type { Request } from "express";
import { env } from "../env.js";

/** Quién está del otro lado de verdad, para rate limit y analítica (F3.6). */
export interface VisitorContext {
  ip: string;
  userAgent: string | null;
  /** País ISO-3166 alfa-2 aproximado, si la plataforma de hosting de apps/web lo informa. */
  country: string | null;
  city: string | null;
}

function header(request: Request, name: string): string | null {
  const value = request.get(name);
  return value && value.trim().length > 0 ? value.trim() : null;
}

/** apps/web reenvía la ciudad codificada como URL (una cabecera HTTP no admite, p. ej., "ñ" en
 *  todos los casos). */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isTrustedProxy(request: Request): boolean {
  const provided = header(request, VISITOR_PROXY_HEADERS.secret);
  if (!provided) {
    return false;
  }
  const expected = Buffer.from(env.INTERNAL_PROXY_SECRET);
  const actual = Buffer.from(provided);
  // Comparación en tiempo constante: con `===` el tiempo de respuesta filtra cuántos caracteres
  // del secreto coinciden.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Por defecto, la conexión directa (`request.ip`, el user-agent propio). Si la petición viene de
 * `apps/web` con el secreto compartido, en cambio, los datos del visitante que `apps/web` reenvía,
 * porque la conexión directa en ese caso es la del servidor de `apps/web`, no la del visitante.
 */
export function resolveVisitorContext(request: Request): VisitorContext {
  const direct: VisitorContext = {
    ip: request.ip ?? request.socket.remoteAddress ?? "unknown",
    userAgent: header(request, "user-agent"),
    country: null,
    city: null,
  };

  if (!isTrustedProxy(request)) {
    return direct;
  }

  const country = header(request, VISITOR_PROXY_HEADERS.country)?.toUpperCase() ?? null;
  const city = header(request, VISITOR_PROXY_HEADERS.city);

  return {
    ip: header(request, VISITOR_PROXY_HEADERS.ip) ?? direct.ip,
    // Sin user-agent reenviado queda nulo, a propósito: tomar el propio (el del fetch de apps/web)
    // haría pasar por "navegador" una visita cuyo user-agent real se desconoce.
    userAgent: header(request, VISITOR_PROXY_HEADERS.userAgent),
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    city: city ? safeDecode(city).slice(0, 80) : null,
  };
}
