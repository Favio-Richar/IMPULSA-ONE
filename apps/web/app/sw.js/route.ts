import { buildServiceWorker, SERVICE_WORKER_HEADERS } from "@impulza/pwa";

// Service worker de la app instalable (F10.5). La versión cambia con cada arranque del servidor (un despliegue nuevo): el
// navegador ve bytes distintos, instala la versión nueva y ofrece actualizar. Nunca se cachea esta ruta.
const VERSION = process.env.APP_VERSION ?? String(Date.now());

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildServiceWorker({ version: VERSION }), { headers: SERVICE_WORKER_HEADERS });
}
