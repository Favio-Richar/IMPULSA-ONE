import { loadEnv, nodeEnvSchema, portSchema, urlSchema } from "@impulza/config";
import { z } from "zod";

// Validación mínima por ahora: el worker todavía no abre ninguna conexión real (sin BullMQ/Redis
// todavía, ver README.md "Decisiones de versión"). REDIS_URL se vuelve requerido aquí cuando se
// agregue el primer job real (Fase 1 tardía / Fase 3).
export const env = loadEnv({
  NODE_ENV: nodeEnvSchema,
  // Puerto propio y distinto del de apps/api (PORT=4000) — ambos procesos leen el mismo .env de
  // raíz en desarrollo local, así que no pueden compartir el nombre de variable.
  WORKER_PORT: portSchema.default(4100),
  // Opcional a propósito: Sentry no es requerido para arrancar (F1.10).
  SENTRY_DSN: urlSchema.optional(),
  SENTRY_RELEASE: z.string().optional(),
});
