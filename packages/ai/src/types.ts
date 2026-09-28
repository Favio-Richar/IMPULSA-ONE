import type { z } from "zod";

// Motor de IA (F6.2, ADR-010). Todo lo que sabe de proveedores vive en este paquete: el resto del
// sistema pide "una salida con este esquema para esta tarea" y recibe datos ya validados, o un
// error con un resultado técnico estable. Nunca texto crudo de un modelo.

/** Tareas del asistente. Cada una tiene su propia ruta de conexiones (modelo rápido o capaz). */
export const AI_TASKS = ["short_copy", "seo", "translate", "insights"] as const;
export type AiTask = (typeof AI_TASKS)[number];

/**
 * `OPENAI_COMPATIBLE`: `POST {baseUrl}/chat/completions`. Cubre Ollama, vLLM, LM Studio, llama.cpp,
 * OpenAI, Gemini (endpoint compatible), Groq, OpenRouter, Together, DeepSeek, Mistral…
 * `ANTHROPIC`: Messages API de Claude con el SDK oficial.
 */
export const AI_PROVIDER_KINDS = ["OPENAI_COMPATIBLE", "ANTHROPIC"] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/**
 * Cómo se le pide JSON a una conexión compatible con OpenAI. No todos los servidores soportan lo
 * mismo: `json_schema` (salida forzada por esquema: OpenAI, vLLM, Ollama recientes), `json_object`
 * (JSON válido sin esquema) o `prompt` (solo la instrucción). En los tres casos el esquema va en las
 * instrucciones y la respuesta se valida igual con Zod.
 */
export const AI_JSON_MODES = ["json_schema", "json_object", "prompt"] as const;
export type AiJsonMode = (typeof AI_JSON_MODES)[number];

/** Resultado técnico de un intento, para el registro de uso (`AiUsage`). */
export const AI_OUTCOMES = ["ok", "timeout", "invalid_output", "rate_limited", "auth_error", "refused", "provider_error"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

/** Una conexión ya descifrada, lista para usar. Nunca sale de `apps/api`. */
export interface AiConnectionConfig {
  id: string;
  name: string;
  kind: AiProviderKind;
  /** Obligatoria para `OPENAI_COMPATIBLE` (p. ej. `http://ia.interna:11434/v1`); opcional en Anthropic. */
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  jsonMode: AiJsonMode;
  timeoutMs: number;
  /** Precio en micro-dólares por millón de tokens (0 para un modelo propio). Nunca float (ST §8). */
  inputMicroUsdPerMTok: number;
  outputMicroUsdPerMTok: number;
}

export interface AiRequest<T> {
  /** Instrucciones del sistema: rol, reglas y formato. Sin datos personales ni secretos. */
  system: string;
  /** El pedido concreto, con el contenido de la página o las métricas agregadas. */
  prompt: string;
  schema: z.ZodType<T>;
  /** Nombre corto del esquema (`[a-z_]+`), lo exigen algunos proveedores. */
  schemaName: string;
  maxOutputTokens: number;
  /** Solo lo usan los modelos que lo soportan (Claude); el resto lo ignora. */
  effort?: "low" | "medium" | "high";
}

export interface AiProviderResult {
  /** La salida ya decodificada de JSON, **sin validar** todavía. */
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  /** El modelo que respondió según el proveedor (puede diferir del pedido). */
  model: string;
}

export interface AIProvider {
  generate(request: AiRequest<unknown>, signal: AbortSignal): Promise<AiProviderResult>;
}

export type AiProviderFactory = (connection: AiConnectionConfig) => AIProvider;

/** Error controlado de un proveedor. `transient` dice si vale la pena reintentar la misma conexión. */
export class AiProviderError extends Error {
  constructor(
    readonly outcome: Exclude<AiOutcome, "ok">,
    readonly transient: boolean,
    message: string,
    readonly usage?: { inputTokens: number; outputTokens: number },
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
