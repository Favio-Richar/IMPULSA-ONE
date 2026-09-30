import { z } from "zod";

// Piezas reutilizables — cada app compone su propio schema con las que necesite (ST §17,
// docs/BACKLOG_FASE_0_1.md F0.4/F1.2). No hay un "schema único" porque no todas las apps
// necesitan las mismas variables (el worker no expone PORT, por ejemplo).

export const nodeEnvSchema = z
  .enum(["development", "test", "staging", "production"])
  .default("development");

export const portSchema = z.coerce.number().int().positive().max(65535);

export const databaseUrlSchema = z
  .url()
  .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
    message: "DATABASE_URL debe ser una cadena de conexión de PostgreSQL (postgres:// o postgresql://)",
  });

export const redisUrlSchema = z
  .url()
  .refine((value) => value.startsWith("redis://") || value.startsWith("rediss://"), {
    message: "REDIS_URL debe ser una cadena de conexión de Redis (redis:// o rediss://)",
  });

export const urlSchema = z.url();

// CORS restrictivo (ST §15, no negociable) — lista explícita separada por comas, nunca "*".
export const corsOriginsSchema = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

// Clave simétrica para cifrar secretos en reposo (ej. secreto TOTP de 2FA) — 32 bytes en base64.
export const encryptionKeySchema = z.string().refine(
  (value) => {
    try {
      return Buffer.from(value, "base64").length === 32;
    } catch {
      return false;
    }
  },
  { message: "Debe ser una clave de 32 bytes en base64 (ej: `openssl rand -base64 32`)." },
);

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

/**
 * Valida `source` contra `shape` y devuelve el resultado tipado, o lanza con un mensaje legible
 * listando cada variable inválida/faltante. Se llama una sola vez, al arrancar cada app — nunca
 * debe arrancar un proceso con configuración inválida (no negociable de seguridad, CLAUDE.md).
 */
export function loadEnv<TShape extends z.ZodRawShape>(
  shape: TShape,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<z.ZodObject<TShape>> {
  const schema = z.object(shape);
  const result = schema.safeParse(source);

  if (!result.success) {
    throw new Error(
      `Configuración de entorno inválida. Revisa tu .env / variables de entorno:\n${formatZodError(result.error)}`,
    );
  }

  return result.data;
}

/**
 * Pruebas automáticas: si hay `TEST_DATABASE_URL`/`TEST_REDIS_URL`, reemplazan a `DATABASE_URL`/
 * `REDIS_URL` para todo el proceso de pruebas. Así ninguna prueba toca la base ni el Redis de
 * desarrollo (ni el worker de desarrollo toca los datos de una prueba). Se llama en el archivo de
 * configuración de vitest, **antes** de importar nada que se conecte.
 */
export function useTestServices(env: NodeJS.ProcessEnv = process.env): void {
  if (env.TEST_DATABASE_URL) env.DATABASE_URL = env.TEST_DATABASE_URL;
  if (env.TEST_REDIS_URL) env.REDIS_URL = env.TEST_REDIS_URL;
}
