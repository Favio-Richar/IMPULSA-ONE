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
