import { findImagesWithoutAlt, IMAGE_ALT_REQUIRED_MESSAGE } from "@impulza/validation";
import type { z } from "zod";
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import { normalizeBlockConfig } from "./normalize";
import type { FieldDescriptor } from "./types.js";

/**
 * Resolver de `react-hook-form` a medida en vez de `zodResolver` directo: el schema del catálogo
 * (`@impulza/validation`) valida la forma **normalizada** (`undefined` en lo opcional vacío), no
 * la forma que el formulario tiene siempre (`""`, objetos de imagen sin URL) — `zodResolver` puro
 * validaría el formulario tal cual y marcaría como inválido cualquier sección opcional que el
 * usuario no llenó todavía. Esto normaliza primero y solo entonces valida, así los errores que
 * llegan a `formState.errors` son reales: algo que el servidor también rechazaría.
 */
export function createBlockConfigResolver(
  schema: z.ZodType,
  fields: readonly FieldDescriptor[],
): Resolver<FieldValues> {
  return (rawValues) => {
    const normalized = normalizeBlockConfig(rawValues, fields);
    const result = schema.safeParse(normalized);

    if (result.success) {
      // Misma regla de escritura que aplica la API (PP2): sin texto alternativo, la imagen tiene
      // que estar marcada como decorativa.
      const missingAlt = findImagesWithoutAlt(result.data);
      if (missingAlt.length === 0) {
        return { values: result.data as FieldValues, errors: {} };
      }
      const altErrors: Record<string, unknown> = {};
      for (const path of missingAlt) {
        setNestedError(altErrors, path, { type: "custom", message: IMAGE_ALT_REQUIRED_MESSAGE });
      }
      return { values: {}, errors: altErrors as FieldErrors<FieldValues> };
    }

    const errors: Record<string, unknown> = {};
    for (const issue of result.error.issues) {
      if (issue.path.length === 0) {
        continue;
      }
      setNestedError(errors, issue.path.map(String), { type: issue.code, message: issue.message });
    }
    return { values: {}, errors: errors as FieldErrors<FieldValues> };
  };
}

function setNestedError(
  target: Record<string, unknown>,
  path: readonly string[],
  error: { type: string; message: string },
): void {
  let node = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!;
    const next = node[key];
    if (typeof next !== "object" || next === null) {
      node[key] = {};
    }
    node = node[key] as Record<string, unknown>;
  }
  const lastKey = path[path.length - 1]!;
  // Un solo error por campo — el primero que Zod reportó ahí es suficiente para que el usuario
  // sepa qué corregir; no hace falta acumular varios.
  if (!(lastKey in node)) {
    node[lastKey] = error;
  }
}
