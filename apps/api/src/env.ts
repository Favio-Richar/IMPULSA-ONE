import { databaseUrlSchema, loadEnv, nodeEnvSchema, portSchema, redisUrlSchema } from "@impulza/config";

// Se valida una sola vez, al importar este módulo (primer import en main.ts) — si falta o es
// inválida una variable requerida, el proceso no debe arrancar (ST §15, F1.2).
export const env = loadEnv({
  NODE_ENV: nodeEnvSchema,
  PORT: portSchema.default(4000),
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
});
