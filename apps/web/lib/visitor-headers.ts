import { VISITOR_PROXY_HEADERS } from "@impulza/analytics";
import { env } from "./env";

/** Lo mínimo que se necesita de las cabeceras entrantes: sirve tanto `Request.headers` como el
 *  resultado de `headers()` de Next. */
export interface VisitorProxyHeaderSource {
  get(name: string): string | null;
}

// Cabeceras de geolocalización que ya ponen las plataformas de hosting más comunes delante de
// apps/web. Se deriva país/ciudad de acá, en el momento, sin base GeoIP propia ni guardar la IP
// (ADR-004 punto 1). Si ninguna está presente (p. ej. en desarrollo local), no hay geo, y está bien.
const COUNTRY_HEADERS = ["x-vercel-ip-country", "cf-ipcountry", "cloudfront-viewer-country"];
const CITY_HEADERS = ["x-vercel-ip-city"];

function firstHeader(source: VisitorProxyHeaderSource, names: string[]): string | null {
  for (const name of names) {
    const value = source.get(name);
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/**
 * La IP del visitante según el proxy/CDN que está delante de apps/web. Primero las cabeceras que la
 * propia plataforma fija y el cliente no puede influir (`cf-connecting-ip` de Cloudflare,
 * `x-real-ip` de Vercel/nginx). Si no hay ninguna, el **último** salto de `x-forwarded-for`, nunca
 * el primero: un proxy que agrega a la cadena conserva lo que haya mandado el cliente, así que el
 * primer valor es falsificable y serviría para saltarse el rate limit con una IP inventada.
 */
function clientIp(source: VisitorProxyHeaderSource): string | null {
  const trusted = firstHeader(source, ["cf-connecting-ip", "x-real-ip"]);
  if (trusted) {
    return trusted;
  }
  const last = source.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return last && last.length > 0 ? last : null;
}

/**
 * Cabeceras para reenviar a apps/api los datos del visitante real en cada llamada
 * server-to-server que ocurre por una petición suya (F3.6). Sin esto, para la API todo el tráfico
 * público venía del servidor de apps/web: el rate limit era un solo balde para todos los
 * visitantes y la exclusión de bots no podía funcionar. El secreto hace que la API les crea; nunca
 * llega al navegador (esta función solo corre en el servidor).
 */
export function visitorProxyHeaders(source: VisitorProxyHeaderSource): Record<string, string> {
  const headers: Record<string, string> = { [VISITOR_PROXY_HEADERS.secret]: env.INTERNAL_PROXY_SECRET };

  const ip = clientIp(source);
  if (ip) {
    headers[VISITOR_PROXY_HEADERS.ip] = ip;
  }
  const userAgent = source.get("user-agent");
  if (userAgent) {
    headers[VISITOR_PROXY_HEADERS.userAgent] = userAgent;
  }
  const country = firstHeader(source, COUNTRY_HEADERS);
  if (country) {
    headers[VISITOR_PROXY_HEADERS.country] = country;
  }
  // Se reenvía tal cual llega (codificada como URL): decodificada, una ciudad con caracteres
  // fuera de Latin-1 haría fallar el `fetch` (las cabeceras HTTP no los admiten). La API decodifica.
  const city = firstHeader(source, CITY_HEADERS);
  if (city) {
    headers[VISITOR_PROXY_HEADERS.city] = city;
  }

  return headers;
}
