import { z } from "zod";

// Validado al importar este módulo, e importado desde `next.config.ts` (se ejecuta antes que
// cualquier otra cosa en `next dev`/`build`/`start`) para que una variable faltante detenga el
// arranque en vez de fallar a mitad de una petición (CLAUDE.md, "variables de entorno validadas
// al iniciar"). Nunca `NEXT_PUBLIC_*`: las dos son server-only — el navegador del visitante nunca
// llama a la API directamente ni conoce este secreto (F2.7, render enteramente en el servidor).
const envSchema = z.object({
  // Base server-to-server para llegar a apps/api, p. ej. http://localhost:4000/api/v1.
  API_BASE_URL: z.url(),
  // Secreto compartido con apps/api: lo exige `app/api/revalidate/route.ts` en cada llamada del
  // webhook de invalidación de caché (F2.7). Mismo criterio de longitud que
  // `WEB_REVALIDATE_SECRET` en apps/api/src/env.ts.
  REVALIDATE_SECRET: z.string().min(32),
  // Origen público de este mismo proceso (F2.8), p. ej. https://impulza.one o
  // http://localhost:3300 en desarrollo — sin path ni slash final. Todo lo que sirve una URL
  // absoluta a un visitante o a un crawler (canonical, Open Graph, `sitemap.xml`, el `Sitemap:` de
  // `robots.txt`) se arma con esta base, nunca adivinándola del header `Host` de la petición: ese
  // header lo controla quien lo manda, y una URL de SEO mal armada es una vía de manipulación, no
  // solo un bug cosmético.
  PUBLIC_WEB_BASE_URL: z.url(),
  // Secreto compartido con apps/api (F3.6): acompaña a las cabeceras con la IP/user-agent/país del
  // visitante real (lib/visitor-headers.ts) para que la API les crea. Server-only, igual que
  // REVALIDATE_SECRET: nunca llega al navegador.
  INTERNAL_PROXY_SECRET: z.string().min(32),
  // Origen público de apps/dashboard (la app del panel/onboarding, proceso y puerto aparte de este
  // sitio de marketing), p. ej. https://app.impulza.one o http://localhost:3100 en desarrollo — sin
  // path ni slash final. La landing enlaza "Crear mi portal gratis" e "Iniciar sesión" hacia esa
  // otra app: nunca un href relativo como "/bienvenida", porque esa ruta no existe en este proceso
  // y sería un enlace roto en producción (F2.8: dos apps, dos orígenes).
  DASHBOARD_BASE_URL: z.url(),
});

export const env = envSchema.parse({
  API_BASE_URL: process.env.API_BASE_URL,
  REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
  PUBLIC_WEB_BASE_URL: process.env.PUBLIC_WEB_BASE_URL,
  INTERNAL_PROXY_SECRET: process.env.INTERNAL_PROXY_SECRET,
  DASHBOARD_BASE_URL: process.env.DASHBOARD_BASE_URL,
});
