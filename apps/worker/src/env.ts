import { databaseUrlSchema, loadEnv, nodeEnvSchema, portSchema, redisUrlSchema, urlSchema } from "@impulza/config";
import { z } from "zod";

export const env = loadEnv({
  NODE_ENV: nodeEnvSchema,
  // Puerto propio y distinto del de apps/api (PORT=4000): ambos procesos leen el mismo .env de
  // raíz en desarrollo local, así que no pueden compartir el nombre de variable.
  WORKER_PORT: portSchema.default(4100),
  // F3.6: primer trabajo real del worker (pipeline de analítica), así que Postgres y Redis pasan a
  // ser requeridos para arrancar.
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  // Retención del AnalyticsEvent crudo (ADR-004 punto 4): en configuración, no en el código, para
  // que el propietario la ajuste al publicar su política de privacidad sin migración ni deploy de
  // código. Nunca "indefinida": hay mínimo y máximo.
  ANALYTICS_RETENTION_MONTHS: z.coerce.number().int().min(1).max(120).default(14),
  // Opcional a propósito: Sentry no es requerido para arrancar (F1.10).
  SENTRY_DSN: urlSchema.optional(),
  SENTRY_RELEASE: z.string().optional(),
});
