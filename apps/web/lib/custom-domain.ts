// Dominios propios (F4.7): qué host es de la plataforma y cómo se traduce una ruta pedida en un
// dominio propio a la ruta interna del sitio. Funciones puras: `proxy.ts` solo las orquesta.

/** Hosts de desarrollo y pruebas que siempre son la plataforma (nunca un dominio propio). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** El nombre de host de la cabecera `Host`, sin puerto y en minúsculas. */
export function hostnameOf(hostHeader: string | null): string {
  if (!hostHeader) {
    return "";
  }
  const host = hostHeader.trim().toLowerCase();
  // IPv6 entre corchetes conserva los `:` internos; en otro caso, el puerto va tras el último `:`.
  if (host.startsWith("[")) {
    return host.slice(0, host.indexOf("]") + 1);
  }
  return host.split(":")[0] ?? "";
}

/** `true` si la petición llegó por la propia plataforma: se sirve tal cual, sin buscar dominio. */
export function isPlatformHost(hostname: string, publicBaseUrl: string): boolean {
  return hostname === "" || LOCAL_HOSTS.has(hostname) || hostname === new URL(publicBaseUrl).hostname;
}

/**
 * Ruta interna para `pathname` pedido en el dominio propio del sitio `siteSlug`: `/` es la página
 * de inicio (`/<slug>`) y `/contacto`, la página `contacto`. Los enlaces que la propia página arma
 * con el slug (`/<slug>/contacto`) ya son rutas internas y se dejan igual, así la navegación dentro
 * del sitio funciona en los dos dominios. Nunca sale del sitio: todo queda bajo `/<slug>`.
 */
export function internalPathFor(siteSlug: string, pathname: string): string {
  const base = `/${siteSlug}`;
  if (pathname === base || pathname.startsWith(`${base}/`)) {
    return pathname;
  }
  return pathname === "/" ? base : `${base}${pathname}`;
}

/** Caché en memoria del proceso: dominio → slug (o `null` si no es un dominio verificado). */
export class DomainCache {
  private readonly entries = new Map<string, { slug: string | null; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly negativeTtlMs = 30_000,
    private readonly maxEntries = 1000,
  ) {}

  get(hostname: string, now = Date.now()): { slug: string | null } | undefined {
    const entry = this.entries.get(hostname);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= now) {
      this.entries.delete(hostname);
      return undefined;
    }
    return { slug: entry.slug };
  }

  set(hostname: string, slug: string | null, now = Date.now()): void {
    if (this.entries.size >= this.maxEntries) {
      // La más antigua sale primero (orden de inserción del Map).
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(hostname, { slug, expiresAt: now + (slug === null ? this.negativeTtlMs : this.ttlMs) });
  }
}
