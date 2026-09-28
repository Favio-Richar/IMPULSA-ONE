import { z } from "zod";
import type { BlockType } from "../blocks/catalog.js";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "../seo/index.js";

// Asistente de textos (F6.3). Qué textos de cada bloque puede proponer o traducir la IA, y cómo se
// leen y escriben en una configuración. Isomorfo: la API lo usa para armar el pedido y validar la
// respuesta; el panel, para aplicar una propuesta sobre la configuración vigente del bloque. La IA
// nunca toca URLs, ids, teléfonos, precios ni estilos: solo las rutas de texto declaradas acá.

/** Idiomas de destino de la traducción: lista cerrada, el modelo no recibe un idioma libre. */
export const AI_TRANSLATION_LOCALES = ["es", "en", "pt", "fr", "it", "de"] as const;
export type AiTranslationLocale = (typeof AI_TRANSLATION_LOCALES)[number];

export const AI_TRANSLATION_LOCALE_LABELS: Record<AiTranslationLocale, string> = {
  es: "Español",
  en: "Inglés",
  pt: "Portugués",
  fr: "Francés",
  it: "Italiano",
  de: "Alemán",
};

/** Texto de una ruta. `rich` = HTML del usuario: vuelve a pasar por el sanitizador del servidor. */
export interface AiTextPath {
  /** Sintaxis del catálogo de bloques: `campo`, `campo.subcampo`, `lista[].campo`. */
  path: string;
  label: string;
  max: number;
  rich?: boolean;
}

const ALT_MAX = 300;
const RICH_MAX = 20_000;

/**
 * Textos que el asistente puede **reescribir** (títulos, subtítulos, textos de botones). Solo textos
 * cortos de venta: el nombre de la persona o del negocio, las preguntas frecuentes o los testimonios
 * no se inventan. Una ruta opcional ausente se propone igual (p. ej. un perfil sin subtítulo), salvo
 * las que dependen de otro campo (el texto del botón de un hero sin botón no tiene dónde ir).
 */
export const AI_COPY_PATHS: Partial<Record<BlockType, AiTextPath[]>> = {
  profile: [{ path: "headline", label: "Subtítulo", max: 160 }],
  hero: [
    { path: "title", label: "Título", max: 160 },
    { path: "subtitle", label: "Subtítulo", max: 300 },
    { path: "cta.label", label: "Texto del botón", max: 60 },
  ],
  link: [
    { path: "label", label: "Texto del botón", max: 80 },
    { path: "description", label: "Descripción", max: 160 },
  ],
  whatsapp: [{ path: "label", label: "Texto del botón", max: 60 }],
  contact_actions: [
    { path: "emailLabel", label: "Texto del botón de correo", max: 60 },
    { path: "phoneLabel", label: "Texto del botón de teléfono", max: 60 },
  ],
  contact_form: [{ path: "title", label: "Título", max: 160 }],
  service: [{ path: "cta.label", label: "Texto del botón", max: 60 }],
  booking: [{ path: "label", label: "Texto del botón", max: 80 }],
  catalog: [{ path: "label", label: "Texto del botón", max: 80 }],
};

/** Una ruta de copia solo se ofrece si el campo del que depende existe. */
const COPY_PATH_REQUIRES: Record<string, string> = {
  "hero:cta.label": "cta",
  "service:cta.label": "cta",
  "contact_actions:emailLabel": "email",
  "contact_actions:phoneLabel": "phone",
};

/** Textos que el asistente puede **traducir**: todo lo que el visitante lee, incluido el texto alternativo. */
export const AI_TRANSLATE_PATHS: Partial<Record<BlockType, AiTextPath[]>> = {
  profile: [
    { path: "headline", label: "Subtítulo", max: 160 },
    { path: "bio", label: "Biografía", max: RICH_MAX, rich: true },
    { path: "avatar.alt", label: "Texto alternativo del avatar", max: ALT_MAX },
    { path: "cover.alt", label: "Texto alternativo de la portada", max: ALT_MAX },
  ],
  hero: [
    { path: "title", label: "Título", max: 160 },
    { path: "subtitle", label: "Subtítulo", max: 300 },
    { path: "cta.label", label: "Texto del botón", max: 60 },
    { path: "background.alt", label: "Texto alternativo del fondo", max: ALT_MAX },
  ],
  text: [{ path: "html", label: "Texto", max: RICH_MAX, rich: true }],
  link: [
    { path: "label", label: "Texto del botón", max: 80 },
    { path: "description", label: "Descripción", max: 160 },
  ],
  image: [
    { path: "caption", label: "Pie de foto", max: 300 },
    { path: "image.alt", label: "Texto alternativo", max: ALT_MAX },
  ],
  gallery: [{ path: "images[].alt", label: "Texto alternativo de la imagen", max: ALT_MAX }],
  video: [{ path: "title", label: "Título", max: 160 }],
  whatsapp: [
    { path: "label", label: "Texto del botón", max: 60 },
    { path: "prefilledMessage", label: "Mensaje precargado", max: 500 },
  ],
  contact_actions: [
    { path: "emailLabel", label: "Texto del botón de correo", max: 60 },
    { path: "phoneLabel", label: "Texto del botón de teléfono", max: 60 },
  ],
  contact_form: [{ path: "title", label: "Título", max: 160 }],
  service: [
    { path: "name", label: "Nombre", max: 120 },
    { path: "description", label: "Descripción", max: RICH_MAX, rich: true },
    { path: "cta.label", label: "Texto del botón", max: 60 },
    { path: "image.alt", label: "Texto alternativo", max: ALT_MAX },
  ],
  faq: [
    { path: "title", label: "Título", max: 160 },
    { path: "items[].question", label: "Pregunta", max: 300 },
    { path: "items[].answer", label: "Respuesta", max: RICH_MAX, rich: true },
  ],
  testimonials: [
    { path: "title", label: "Título", max: 160 },
    { path: "items[].quote", label: "Testimonio", max: 800 },
    { path: "items[].role", label: "Cargo", max: 120 },
    { path: "items[].avatar.alt", label: "Texto alternativo de la foto", max: ALT_MAX },
  ],
  booking: [{ path: "label", label: "Texto del botón", max: 80 }],
  catalog: [{ path: "label", label: "Texto del botón", max: 80 }],
};

/** Un texto concreto de una configuración: la ruta declarada ya resuelta (`items.2.question`). */
export interface AiTextField {
  /** Clave estable dentro de la configuración, con índices: `items.2.question`. */
  key: string;
  label: string;
  max: number;
  rich: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resuelve `items[].answer` contra una configuración en claves concretas (`items.0.answer`, …). */
function expandPath(config: unknown, path: string): string[] {
  const [head, ...rest] = path.split("[]");
  if (rest.length === 0) {
    return [path];
  }
  const list = readKey(config, head!);
  if (!Array.isArray(list)) {
    return [];
  }
  const tail = rest.join("[]").replace(/^\./, "");
  return list.flatMap((item, index) => expandPath(item, tail).map((key) => `${head}.${index}.${key}`));
}

function readKey(config: unknown, key: string): unknown {
  let current: unknown = config;
  for (const segment of key.split(".")) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function listFields(config: unknown, paths: AiTextPath[]): AiTextField[] {
  return paths.flatMap((declared) => {
    const keys = expandPath(config, declared.path);
    return keys.map((key) => {
      const index = /\.(\d+)\./.exec(key)?.[1];
      return {
        key,
        label: index === undefined ? declared.label : `${declared.label} ${Number(index) + 1}`,
        max: declared.max,
        rich: declared.rich === true,
      };
    });
  });
}

/** Textos del bloque que el asistente puede reescribir. Vacío = el bloque no admite propuestas. */
export function copyFieldsFor(type: string, config: unknown): AiTextField[] {
  const paths = (AI_COPY_PATHS[type as BlockType] ?? []).filter((declared) => {
    const requires = COPY_PATH_REQUIRES[`${type}:${declared.path}`];
    return requires === undefined || readKey(config, requires) !== undefined;
  });
  return listFields(config, paths);
}

/** Textos **no vacíos** del bloque que se pueden traducir (lo vacío no se manda al modelo). */
export function translateFieldsFor(type: string, config: unknown): AiTextField[] {
  return listFields(config, AI_TRANSLATE_PATHS[type as BlockType] ?? []).filter((field) => {
    const value = readKey(config, field.key);
    return typeof value === "string" && value.trim() !== "";
  });
}

/** Los textos actuales de esas claves (`""` si todavía no existen). */
export function readTextFields(config: unknown, fields: AiTextField[]): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => {
      const value = readKey(config, field.key);
      return [field.key, typeof value === "string" ? value : ""];
    }),
  );
}

/**
 * Devuelve una copia de la configuración con esos textos escritos. Solo escribe en claves que ya
 * existen como objeto contenedor (o en la raíz): nunca crea un botón, una imagen o un ítem nuevo.
 * Una clave desconocida para el bloque se ignora — el que llama pasa solo claves de `copyFieldsFor`
 * o `translateFieldsFor`.
 */
export function writeTextFields(config: unknown, values: Record<string, string>): Record<string, unknown> {
  const copy = structuredClone(isRecord(config) ? config : {});
  for (const [key, value] of Object.entries(values)) {
    const segments = key.split(".");
    const last = segments.pop()!;
    let container: unknown = copy;
    for (const segment of segments) {
      container = Array.isArray(container) ? container[Number(segment)] : isRecord(container) ? container[segment] : undefined;
    }
    if (Array.isArray(container) && /^\d+$/.test(last)) {
      continue;
    }
    if (isRecord(container)) {
      container[last] = value;
    }
  }
  return copy;
}

// --- pedidos y salidas ------------------------------------------------------------------------------

/**
 * Indicación opcional del usuario ("más formal", "para una clínica dental"). Corta y en texto plano:
 * el modelo la recibe marcada como preferencia de estilo, nunca como instrucciones del sistema.
 */
export const aiInstructionsSchema = z.string().trim().max(300).optional();

export const aiBlockCopyRequestSchema = z.object({
  blockId: z.uuid(),
  instructions: aiInstructionsSchema,
});
export type AiBlockCopyRequest = z.infer<typeof aiBlockCopyRequestSchema>;

export const aiSeoRequestSchema = z.object({ instructions: aiInstructionsSchema });
export type AiSeoRequest = z.infer<typeof aiSeoRequestSchema>;

export const aiTranslateRequestSchema = z.object({
  blockId: z.uuid(),
  locale: z.enum(AI_TRANSLATION_LOCALES),
});
export type AiTranslateRequest = z.infer<typeof aiTranslateRequestSchema>;

/** Máximo de caracteres que se mandan a traducir de una vez (un bloque de preguntas muy largo se parte). */
export const AI_TRANSLATE_MAX_CHARS = 12_000;

export const AI_MAX_PROPOSALS = 3;

/**
 * Esquema de la salida del modelo para esos textos: `{ proposals: [{ values: { clave: texto } }] }`,
 * con el largo máximo de cada campo. Es lo que ve el proveedor como JSON Schema y lo que valida la
 * respuesta; después, la configuración resultante vuelve a pasar por el esquema del bloque.
 */
export function textProposalsSchema(fields: AiTextField[], maxProposals: number) {
  const shape = Object.fromEntries(fields.map((field) => [field.key, z.string().trim().min(1).max(field.max)]));
  return z.object({
    proposals: z
      .array(z.object({ values: z.object(shape).strict() }))
      .min(1)
      .max(maxProposals),
  });
}

export const seoProposalsSchema = z.object({
  proposals: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(SEO_TITLE_MAX),
        description: z.string().trim().min(1).max(SEO_DESCRIPTION_MAX),
      }),
    )
    .min(1)
    .max(AI_MAX_PROPOSALS),
});
