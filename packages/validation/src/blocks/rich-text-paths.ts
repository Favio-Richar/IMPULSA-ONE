import type { z } from "zod";
import { RICH_TEXT_MARKER } from "./primitives.js";

// Recorre un esquema de bloque y devuelve las rutas de todos los campos marcados como texto
// enriquecido. Es la contraparte verificable de `BlockDefinition.richTextPaths`: una prueba
// compara ambas listas, de modo que agregar un campo de HTML del usuario sin declararlo rompe el
// build en vez de colarse sin sanitizar hasta la página pública.
//
// Sintaxis de ruta, la misma que consume el sanitizador del servidor:
//   `campo`, `campo.subcampo`, `lista[].campo`

interface ZodLikeDef {
  type?: string;
  shape?: Record<string, unknown>;
  element?: unknown;
  innerType?: unknown;
  options?: unknown[];
}

function defOf(schema: unknown): ZodLikeDef | undefined {
  return (schema as { def?: ZodLikeDef } | undefined)?.def;
}

function descriptionOf(schema: unknown): string | undefined {
  return (schema as { description?: string } | undefined)?.description;
}

export function collectRichTextPaths(schema: z.ZodType): string[] {
  const found: string[] = [];

  function walk(node: unknown, path: string): void {
    if (node === null || typeof node !== "object") {
      return;
    }

    if (descriptionOf(node) === RICH_TEXT_MARKER && path.length > 0) {
      found.push(path);
      return;
    }

    const def = defOf(node);
    if (!def) {
      return;
    }

    // `optional()`, `default()`, `nullable()`, etc. envuelven el esquema real sin cambiar la ruta.
    if (def.innerType !== undefined) {
      walk(def.innerType, path);
      return;
    }

    if (def.type === "object" && def.shape) {
      for (const [key, child] of Object.entries(def.shape)) {
        walk(child, path.length === 0 ? key : `${path}.${key}`);
      }
      return;
    }

    if (def.type === "array" && def.element !== undefined) {
      walk(def.element, `${path}[]`);
      return;
    }

    if (Array.isArray(def.options)) {
      for (const option of def.options) {
        walk(option, path);
      }
    }
  }

  walk(schema, "");

  return found.sort();
}
