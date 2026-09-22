import type { FieldControl, FieldDescriptor } from "./types.js";

/**
 * El formulario siempre tiene un valor controlado para cada input (`""` para texto vacío, un
 * objeto `{url:"",alt:""}` para una imagen sin elegir) — el schema Zod real del catálogo
 * (`@impulza/validation`) no acepta eso en un campo opcional, solo `undefined`. Esto convierte lo
 * que el formulario tiene en lo que el schema espera antes de cada intento de guardado, para que
 * el autoguardado no falle solo porque el usuario todavía no llenó una sección opcional — tanto a
 * nivel del bloque como dentro de un `group` o de cada ítem de un `array` (p. ej. `role` en
 * `testimonials.items`, opcional dentro de cada testimonio).
 */
export function normalizeBlockConfig(
  value: Record<string, unknown>,
  fields: readonly FieldDescriptor[],
): Record<string, unknown> {
  return normalizeObject(value, fields);
}

function normalizeObject(raw: unknown, fields: readonly FieldDescriptor[]): Record<string, unknown> {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const normalized = normalizeLeaf(obj[field.name], field.control);
    if (field.optional && isDeepEmpty(normalized)) {
      continue;
    }
    result[field.name] = normalized;
  }
  return result;
}

function normalizeLeaf(raw: unknown, control: FieldControl): unknown {
  switch (control.kind) {
    case "text":
    case "url":
    case "email":
    case "phone":
    case "richtext":
    case "video":
      return typeof raw === "string" ? raw.trim() : "";
    case "number":
      return typeof raw === "number" && !Number.isNaN(raw) ? raw : undefined;
    case "boolean":
      return Boolean(raw);
    case "select":
      return typeof raw === "string" ? raw : "";
    case "multiselect":
      return Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : [];
    case "image": {
      const obj = (raw ?? {}) as Record<string, unknown>;
      const normalized: Record<string, unknown> = {
        url: typeof obj.url === "string" ? obj.url.trim() : "",
        alt: typeof obj.alt === "string" ? obj.alt.trim() : "",
      };
      if (obj.decorative) {
        normalized.decorative = true;
      }
      return normalized;
    }
    case "group":
      return normalizeObject(raw, control.fields);
    case "array": {
      const arr = Array.isArray(raw) ? raw : [];
      return arr.map((item) => normalizeObject(item, control.fields));
    }
  }
}

function isDeepEmpty(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isDeepEmpty);
  }
  return false;
}
