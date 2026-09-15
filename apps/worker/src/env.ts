import { loadEnv, nodeEnvSchema } from "@impulza/config";

// Validación mínima por ahora: el worker todavía no abre ninguna conexión real (sin BullMQ/Redis
// todavía, ver README.md "Decisiones de versión"). REDIS_URL se vuelve requerido aquí cuando se
// agregue el primer job real (Fase 1 tardía / Fase 3).
export const env = loadEnv({
  NODE_ENV: nodeEnvSchema,
});
