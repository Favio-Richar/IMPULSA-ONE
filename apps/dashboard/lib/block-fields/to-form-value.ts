import { musicPublicUrl, storedMusicSchema } from "@impulza/validation";
import type { FieldControl, FieldDescriptor } from "./types.js";

const EMBED_URL_BY_PROVIDER: Record<string, (videoId: string, vertical: boolean) => string> = {
  youtube: (videoId, vertical) => (vertical ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`),
  vimeo: (videoId) => `https://vimeo.com/${videoId}`,
  tiktok: (videoId) => `https://www.tiktok.com/player/v1/${videoId}`,
};

function videoDisplayUrl(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object" && "provider" in raw && "videoId" in raw) {
    const { provider, videoId, vertical } = raw as { provider: string; videoId: string; vertical?: boolean };
    return EMBED_URL_BY_PROVIDER[provider]?.(videoId, vertical === true) ?? "";
  }
  return "";
}

/** Música guardada (`{provider, …}`) → el enlace público que la vuelve a producir al guardar. */
function musicDisplayUrl(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const parsed = storedMusicSchema.safeParse(raw);
  return parsed.success ? musicPublicUrl(parsed.data) : "";
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
    result[field.name] = toFormLeaf(obj[field.name], field.control, field.optional === true);
  }
  return result;
}

function toFormLeaf(raw: unknown, control: FieldControl, optional = false): unknown {
  switch (control.kind) {
    case "video":
      return videoDisplayUrl(raw);
    case "music":
      return musicDisplayUrl(raw);
    case "lines":
      return Array.isArray(raw) ? raw.filter((item) => typeof item === "string").join("\n") : "";
    case "datetime":
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
      // Un selector obligatorio sin valor guardado (p. ej. un perfil anterior a PL7, sin `layout`)
      // muestra su primera opción: el formulario tiene que tener esa misma, o el primer
      // autoguardado falla con "opción inválida" sin que la persona haya tocado nada.
      return typeof raw === "string" ? raw : optional ? "" : (control.options[0]?.value ?? "");
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
