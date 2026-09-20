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
});

export const env = envSchema.parse({
  API_BASE_URL: process.env.API_BASE_URL,
  REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
});
