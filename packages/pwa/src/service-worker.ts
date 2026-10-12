/**
 * Service worker de la app instalable (F10.5, ADR-029). Se entrega como texto desde una ruta de cada app (`/sw.js`), así que su
 * contenido sale de una sola fuente y se puede probar sin navegador.
 *
 * Reglas, todas pensadas para NO guardar nada que dependa de una persona:
 * - **Nunca** toca peticiones que no sean GET, de otro origen (la API, los medios), ni rutas `/api/`.
 * - Las páginas (navegaciones) van **siempre a la red**; solo si falla se muestra la pantalla «sin conexión» precacheada.
 * - Solo se cachean archivos estáticos con huella (`/_next/static/`) y los íconos: nada con sesión, nada de datos.
 * - Una versión nueva NO se activa sola: espera a que la persona pulse «Actualizar» (mensaje `SKIP_WAITING`).
 */

export interface ServiceWorkerOptions {
  /** Cambia con cada versión del despliegue: renombra la caché y retira la anterior. */
  version: string;
  /** Página estática que se muestra sin conexión (debe existir sin sesión). */
  offlineUrl?: string;
}

/** Prefijos de ruta que se guardan en la caché estática (archivos inmutables). */
export const STATIC_PREFIXES = ["/_next/static/", "/icons/"] as const;
/** Rutas del propio origen que el service worker nunca atiende. */
export const NEVER_HANDLE_PREFIXES = ["/api/", "/sw.js"] as const;

export function buildServiceWorker(options: ServiceWorkerOptions): string {
  const version = options.version.replace(/[^A-Za-z0-9._-]/g, "-");
  const offlineUrl = options.offlineUrl ?? "/offline.html";
  return `/* Impulza One — service worker (F10.5). Generado: no editar a mano. */
const CACHE_PREFIX = "impulza-static-";
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(version)};
const OFFLINE_URL = ${JSON.stringify(offlineUrl)};
const STATIC_PREFIXES = ${JSON.stringify(STATIC_PREFIXES)};
const NEVER_HANDLE_PREFIXES = ${JSON.stringify(NEVER_HANDLE_PREFIXES)};

self.addEventListener("install", (event) => {
  // Sin skipWaiting: una versión nueva espera a que la persona la acepte.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function startsWithAny(pathname, prefixes) {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (startsWithAny(url.pathname, NEVER_HANDLE_PREFIXES)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((cached) => cached || Response.error())),
    );
    return;
  }

  if (startsWithAny(url.pathname, STATIC_PREFIXES)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(request).then((hit) => {
          if (hit) return hit;
          return fetch(request).then((response) => {
            // Solo respuestas completas y sin cookies: nunca se guarda nada ligado a una sesión.
            if (response.ok && response.status === 200 && !response.headers.has("set-cookie")) cache.put(request, response.clone());
            return response;
          });
        }),
      ),
    );
  }
});
`;
}

/** Cabeceras con que se entrega `/sw.js`: sin caché (para que las actualizaciones se vean) y con alcance de toda la app. */
export const SERVICE_WORKER_HEADERS = {
  "content-type": "text/javascript; charset=utf-8",
  "cache-control": "no-cache, no-store, must-revalidate",
  "service-worker-allowed": "/",
  "x-content-type-options": "nosniff",
} as const;
