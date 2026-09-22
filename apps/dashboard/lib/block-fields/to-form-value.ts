import type { FieldControl, FieldDescriptor } from "./types.js";

const EMBED_URL_BY_PROVIDER: Record<string, (videoId: string) => string> = {
  youtube: (videoId) => `https://www.youtube.com/watch?v=${videoId}`,
  vimeo: (videoId) => `https://vimeo.com/${videoId}`,
};

function videoDisplayUrl(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object" && "provider" in raw && "videoId" in raw) {
    const { provider, videoId } = raw as { provider: string; videoId: string };
    return EMBED_URL_BY_PROVIDER[provider]?.(videoId) ?? "";
  }
  return "";
}

/**
 * Config guardada (servidor) → valores controlados del formulario. Necesario por dos razones:
 * `video` se guarda como `{provider, videoId}` pero se edita como una URL de texto, y cualquier
 * campo opcional ausente (p. ej. un `cta` que nunca se llenó) necesita un valor inicial definido
 * — si no, el input pasa de no controlado a controlado en cuanto el usuario escribe, que React
 * marca como error.
 */
export function toFormConfig(config: unknown, fields: readonly FieldDescriptor[]): Record<string, unknown> {
  return toFormObject(config, fields);
}

function toFormObject(raw: unknown, fields: readonly FieldDescriptor[]): Record<string, unknown> {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.name] = toFormLeaf(obj[field.name], field.control);
  }
  return result;
}

function toFormLeaf(raw: unknown, control: FieldControl): unknown {
  switch (control.kind) {
    case "video":
      return videoDisplayUrl(raw);
    case "text":
    case "url":
    case "email":
    case "phone":
    case "richtext":
      return typeof raw === "string" ? raw : "";
    case "number":
      return typeof raw === "number" ? raw : undefined;
    case "boolean":
      return Boolean(raw);
    case "select":
      return typeof raw === "string" ? raw : "";
    case "multiselect":
      return Array.isArray(raw) ? raw : [];
    case "image": {
      const obj = (raw ?? {}) as Record<string, unknown>;
      return {
        url: typeof obj.url === "string" ? obj.url : "",
        alt: typeof obj.alt === "string" ? obj.alt : "",
        decorative: Boolean(obj.decorative),
      };
    }
    case "group":
      return toFormObject(raw, control.fields);
    case "array": {
      const arr = Array.isArray(raw) ? raw : [];
      return arr.map((item) => toFormObject(item, control.fields));
    }
  }
}
