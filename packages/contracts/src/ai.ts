import { z } from "zod";

/**
 * Estado del asistente de IA para una organización (F6.2): si hay modelos configurados para cada
 * tarea y cuánto queda de la cuota del mes. El panel lo usa para mostrar u ocultar las funciones de
 * IA; nunca expone proveedores, modelos ni URLs (son configuración interna de la plataforma).
 */
export const aiStatusResponse = z.object({
  /** Tareas con al menos una conexión activa. Vacío = asistente no disponible. */
  availableTasks: z.array(z.string()),
  quota: z.object({
    /** `null` = sin límite en el plan. */
    limit: z.number().int().nullable(),
    used: z.number().int(),
    /** Mes calendario UTC de la cuota, `AAAA-MM`. */
    period: z.string(),
  }),
});

export type AiStatusResponse = z.infer<typeof aiStatusResponse>;

// --- Asistente de textos (F6.3) -------------------------------------------------------------------

/**
 * Propuestas de texto para un bloque (reescribir o traducir). Cada propuesta trae solo los textos
 * (`values`, por clave de la configuración): el panel los escribe sobre la configuración **vigente**
 * del bloque con `writeTextFields` y la guarda por la ruta normal de edición, así que aplicar nunca
 * pisa otros cambios ni publica. El servidor ya verificó que cada propuesta, aplicada, cumple el
 * esquema del bloque; los textos enriquecidos llegan sanitizados.
 */
export const aiBlockProposalsResponse = z.object({
  blockId: z.uuid(),
  blockType: z.string(),
  fields: z.array(z.object({ key: z.string(), label: z.string(), rich: z.boolean() })),
  current: z.record(z.string(), z.string()),
  proposals: z.array(z.object({ values: z.record(z.string(), z.string()) })).min(1).max(3),
});

/** Propuestas de título y descripción para buscadores. Se aplican al formulario de SEO, que se guarda aparte. */
export const aiSeoProposalsResponse = z.object({
  current: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
  proposals: z.array(z.object({ title: z.string(), description: z.string() })).min(1).max(3),
});

export type AiBlockProposalsResponse = z.infer<typeof aiBlockProposalsResponse>;
export type AiSeoProposalsResponse = z.infer<typeof aiSeoProposalsResponse>;

// --- Superadministración (F6.2b) ------------------------------------------------------------------

/** Una conexión tal como la ve la superadministración: el token **nunca** sale, solo su pista. */
export const adminAiConnectionResponse = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(["OPENAI_COMPATIBLE", "ANTHROPIC"]),
  baseUrl: z.string().nullable(),
  hasApiKey: z.boolean(),
  /** Últimos 4 caracteres del token, para reconocerlo. `null` sin token. */
  apiKeyHint: z.string().nullable(),
  model: z.string(),
  jsonMode: z.enum(["json_schema", "json_object", "prompt"]),
  timeoutMs: z.number().int(),
  inputMicroUsdPerMTok: z.number().int(),
  outputMicroUsdPerMTok: z.number().int(),
  enabled: z.boolean(),
  /** Tareas en cuya ruta figura. */
  tasks: z.array(z.string()),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

/** Ruta de cada tarea: ids de conexión en orden de respaldo (el primero es el principal). */
export const adminAiRoutesResponse = z.object({
  routes: z.record(z.string(), z.array(z.uuid())),
});

/** Resultado de "Probar conexión": una llamada mínima real con el esquema `{ ok: true }`. */
export const adminAiConnectionTestResponse = z.object({
  ok: z.boolean(),
  outcome: z.string(),
  /** Modelo que respondió (puede diferir del configurado, p. ej. un alias). */
  model: z.string().nullable(),
  durationMs: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
});

const usageTotals = {
  requests: z.number().int(),
  attempts: z.number().int(),
  failures: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costMicroUsd: z.number().int(),
};

/** Consumo del mes calendario UTC (`AAAA-MM`), por conexión, por tarea y organizaciones con más uso. */
export const adminAiUsageResponse = z.object({
  period: z.string(),
  totals: z.object(usageTotals),
  byConnection: z.array(z.object({ connectionId: z.uuid().nullable(), name: z.string(), ...usageTotals })),
  byTask: z.array(z.object({ task: z.string(), ...usageTotals })),
  topOrganizations: z.array(z.object({ organizationId: z.uuid(), name: z.string(), requests: z.number().int(), costMicroUsd: z.number().int() })),
});

export type AdminAiConnectionResponse = z.infer<typeof adminAiConnectionResponse>;
export type AdminAiRoutesResponse = z.infer<typeof adminAiRoutesResponse>;
export type AdminAiConnectionTestResponse = z.infer<typeof adminAiConnectionTestResponse>;
export type AdminAiUsageResponse = z.infer<typeof adminAiUsageResponse>;
