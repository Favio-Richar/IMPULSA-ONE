import { z } from "zod";

/**
 * Saca el objeto JSON de la respuesta de un modelo. Los modelos pequeños a veces envuelven la salida
 * en un bloque ```json o agregan una frase antes; se toma desde la primera `{` hasta la última `}`.
 * Devuelve `undefined` si no hay JSON decodificable (el llamador lo trata como `invalid_output`).
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // siguiente candidato
    }
  }
  return undefined;
}

/** JSON Schema del esquema de salida, para mandarlo al proveedor y a las instrucciones. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Instrucción de formato que se agrega al sistema: la leen todos los modelos, soporten o no esquemas. */
export function formatInstruction(schema: z.ZodType): string {
  return [
    "Responde únicamente con un objeto JSON válido, sin texto antes ni después y sin bloques de código.",
    "El objeto debe cumplir exactamente este JSON Schema:",
    JSON.stringify(toJsonSchema(schema)),
  ].join("\n");
}
