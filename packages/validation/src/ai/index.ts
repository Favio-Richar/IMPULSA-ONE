import { z } from "zod";

// Conexiones de IA de la plataforma (F6.2b, ADR-010). Las escribe solo un superadministrador desde
// `apps/admin`; el mismo esquema valida el formulario y, otra vez, el servidor.
//
// Estas listas repiten las de `@impulza/ai` a propósito: `validation` es isomorfo y no puede depender
// de un paquete que trae el SDK de un proveedor. Una prueba verifica que coincidan.

export const AI_TASK_CODES = ["short_copy", "seo", "translate", "insights"] as const;
export type AiTaskCode = (typeof AI_TASK_CODES)[number];

export const AI_TASK_LABELS: Record<AiTaskCode, { label: string; hint: string }> = {
  short_copy: { label: "Textos cortos", hint: "Títulos, subtítulos y textos de botones. Conviene un modelo rápido." },
  seo: { label: "SEO", hint: "Título y descripción para buscadores." },
  translate: { label: "Traducción", hint: "Traducir los textos de un bloque." },
  insights: { label: "Análisis comercial", hint: "Leer métricas y proponer acciones. Conviene un modelo capaz." },
};

export const AI_CONNECTION_KINDS = ["OPENAI_COMPATIBLE", "ANTHROPIC"] as const;
export const AI_CONNECTION_JSON_MODES = ["json_schema", "json_object", "prompt"] as const;

/** Máximo de conexiones en la ruta de una tarea (principal + respaldos). */
export const MAX_AI_ROUTE_LENGTH = 5;

/**
 * URL base de un servidor de modelos. Se aceptan `http` (un servidor propio en red privada o VPN no
 * siempre tiene TLS) y hosts privados — la fija solo un superadministrador (ADR-010) —, pero nunca
 * credenciales en la URL, consulta ni fragmento: el token va en su propio campo, cifrado.
 */
export const aiBaseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "" && url.search === "" && url.hash === "";
    } catch {
      return false;
    }
  }, "Usa una URL http(s) sin usuario, contraseña ni parámetros, por ejemplo http://10.0.0.5:11434/v1.")
  .transform((value) => value.replace(/\/+$/, ""));

const microUsd = z.number().int().min(0).max(1_000_000_000);

const connectionFields = {
  name: z.string().trim().min(2).max(60),
  kind: z.enum(AI_CONNECTION_KINDS),
  baseUrl: aiBaseUrlSchema.nullable(),
  model: z.string().trim().min(1).max(120),
  jsonMode: z.enum(AI_CONNECTION_JSON_MODES),
  timeoutMs: z.number().int().min(1_000).max(300_000),
  inputMicroUsdPerMTok: microUsd,
  outputMicroUsdPerMTok: microUsd,
  enabled: z.boolean(),
};

/** El token se escribe, nunca se lee. En la edición: ausente = conservar, `null` = quitar. */
const apiKeySchema = z.string().trim().min(1).max(500);

const needsUrl = (value: { kind?: string; baseUrl?: string | null }) => value.kind !== "OPENAI_COMPATIBLE" || Boolean(value.baseUrl);
const NEEDS_URL_MESSAGE = { message: "Una conexión compatible con OpenAI necesita la URL del servidor.", path: ["baseUrl"] };

export const createAiConnectionSchema = z
  .object({
    ...connectionFields,
    baseUrl: connectionFields.baseUrl.default(null),
    jsonMode: connectionFields.jsonMode.default("json_schema"),
    timeoutMs: connectionFields.timeoutMs.default(30_000),
    inputMicroUsdPerMTok: microUsd.default(0),
    outputMicroUsdPerMTok: microUsd.default(0),
    enabled: z.boolean().default(true),
    apiKey: apiKeySchema.nullable().default(null),
  })
  .refine(needsUrl, NEEDS_URL_MESSAGE);

export const updateAiConnectionSchema = z
  .object({ ...connectionFields, apiKey: apiKeySchema.nullable() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Envía al menos un campo a modificar." });

export const aiRoutesSchema = z.object({
  routes: z.object(
    Object.fromEntries(AI_TASK_CODES.map((task) => [task, z.array(z.uuid()).max(MAX_AI_ROUTE_LENGTH)])) as Record<
      AiTaskCode,
      z.ZodArray<z.ZodUUID>
    >,
  ).refine((routes) => Object.values(routes).every((ids) => new Set(ids).size === ids.length), {
    message: "Una conexión no puede repetirse en la misma tarea.",
  }),
});

export type CreateAiConnectionInput = z.infer<typeof createAiConnectionSchema>;
export type UpdateAiConnectionInput = z.infer<typeof updateAiConnectionSchema>;
export type AiRoutesInput = z.infer<typeof aiRoutesSchema>;

/** Solo para mostrar: los últimos 4 caracteres de un token. */
export function apiKeyHint(apiKey: string): string {
  return apiKey.slice(-4);
}

/** Precio legible: micro-dólares por millón de tokens → "US$ 3,00". */
export function formatMicroUsd(value: number): string {
  return `US$ ${(value / 1_000_000).toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
export * from "./assistant.js";
