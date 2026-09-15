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
});
