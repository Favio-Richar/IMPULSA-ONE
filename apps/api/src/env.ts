import { z } from "zod";
import {
  corsOriginsSchema,
  databaseUrlSchema,
  encryptionKeySchema,
  loadEnv,
  nodeEnvSchema,
  portSchema,
  redisUrlSchema,
  urlSchema,
} from "@impulza/config";

// Se valida una sola vez, al importar este módulo (primer import en main.ts) — si falta o es
// inválida una variable requerida, el proceso no debe arrancar (ST §15, F1.2).
export const env = loadEnv({
  NODE_ENV: nodeEnvSchema,
  PORT: portSchema.default(4000),
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  // Orígenes exactos permitidos para CORS — nunca "*" (ST §15, no negociable).
  CORS_ORIGINS: corsOriginsSchema,
  // Clave simétrica para cifrar el secreto TOTP de 2FA en reposo.
  AUTH_ENCRYPTION_KEY: encryptionKeySchema,
  // Base de las URLs de verificación/recuperación que se envían por email.
  APP_BASE_URL: urlSchema,
  // Opcional a propósito: Sentry no es requerido para arrancar (F1.10). Sin DSN, initSentry() es
  // un no-op — así se puede desarrollar localmente sin cuenta de Sentry.
  SENTRY_DSN: urlSchema.optional(),
  SENTRY_RELEASE: z.string().optional(),
  // URL base de apps/web y el secreto compartido de su webhook de invalidación de caché (F2.7).
  // Opcionales por el mismo criterio que Sentry: sin ellos, RevalidateWebService no llama a nada
  // y publicar/restaurar siguen funcionando igual — el aviso de caché es best-effort, nunca un
  // requisito para que la API arranque o para que publicar tenga éxito.
  WEB_APP_URL: urlSchema.optional(),
  WEB_REVALIDATE_SECRET: z.string().min(32).optional(),
});
