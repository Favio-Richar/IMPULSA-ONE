import { z } from "zod";
import { getBlockDefinition } from "../blocks/catalog.js";
import { seoMetaSchema } from "../seo/index.js";
import { smartCtaSchema } from "../smart-cta/index.js";
import { createAgencyClientSchema } from "./index.js";

// Duplicar un cliente (F9.5c, ADR-028 §2): crea una organización NUEVA con el contenido del sitio. Estas son las reglas puras de
// qué viaja y qué no. Lo que pertenece al cliente origen —sus medios, sus formularios, sus productos— nunca queda apuntado desde la
// copia: una referencia cruzada entre organizaciones rompería el aislamiento (ADR-002) y filtraría datos del negocio origen.

/** Lo que una duplicación NO copia, dicho al usuario en el informe. */
export const DUPLICATE_NOT_COPIED = [
  "Contactos y respuestas de formularios",
  "Pedidos, reservas y pagos",
  "Cuentas de cobro, claves y medios de pago",
  "Imágenes y videos de la biblioteca del cliente",
  "Dominios propios",
  "Identificadores de medición (Google Analytics y Pixel) y datos de analítica",
  "Productos, servicios, formularios y calendarios (los bloques que los usaban quedan sin configurar)",
  "Historial de publicaciones: todo queda en borrador",
  "Pruebas A/B, embudos y campañas",
  "Razón social y datos fiscales",
] as const;

/** Qué datos del negocio origen conviene revisar antes de publicar la copia, según los bloques que viajaron. */
const REVIEW_HINT_BY_BLOCK: Record<string, string> = {
  whatsapp: "Números de WhatsApp",
  contact_actions: "Correo y teléfono de contacto",
  map: "Dirección del mapa",
  social: "Redes sociales",
  profile: "Nombre, presentación y enlaces del perfil",
  testimonials: "Testimonios (son de personas del negocio origen)",
};

export const duplicateClientSchema = createAgencyClientSchema.extend({
  /** Misma clave = misma petición: reintentar no crea otro cliente. */
  idempotencyKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{8,100}$/, "La clave de idempotencia usa de 8 a 100 letras, números, guiones o guiones bajos."),
});
export type DuplicateClientDto = z.infer<typeof duplicateClientSchema>;

// ---- medios del cliente origen ---------------------------------------------------------------------------------------

/**
 * `true` si el texto apunta a un archivo de la biblioteca (o de la marca) de esa organización. Las claves de almacenamiento llevan
 * `/org/<id>/`: `…/org/<id>/<asset>/w1600.webp`, `branding/org/<id>/…`. Una URL externa (YouTube, otro sitio) no cuenta.
 */
export function referencesOrganizationMedia(text: string, organizationId: string): boolean {
  return text.toLowerCase().includes(`/org/${organizationId.toLowerCase()}/`);
}

/** Se quitó este valor (un archivo del origen): el que lo contiene lo cuenta. */
const REMOVE = Symbol("remove");
/** Un contenedor que quedó vacío justamente por haberle quitado medios: se descarta sin contarlo como otra imagen. */
const EMPTIED = Symbol("emptied");
const HTML_MEDIA_TAG = /<(?:img|source|video|audio)\b[^>]*>/gi;
const LOOKS_LIKE_HTML = /<[a-z][\s\S]*>/i;

function strip(value: unknown, organizationId: string, counter: { removed: number }): unknown {
  if (typeof value === "string") {
    if (LOOKS_LIKE_HTML.test(value)) {
      // Texto enriquecido: se quitan solo las etiquetas de medios del origen y se conserva el texto.
      return value.replace(HTML_MEDIA_TAG, (tag) => {
        if (!referencesOrganizationMedia(tag, organizationId)) return tag;
        counter.removed += 1;
        return "";
      });
    }
    return referencesOrganizationMedia(value, organizationId) ? REMOVE : value;
  }
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    for (const item of value) {
      const result = strip(item, organizationId, counter);
      if (result === REMOVE) counter.removed += 1;
      else if (result !== EMPTIED) kept.push(result);
    }
    return kept;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Una imagen del origen se quita entera (con su texto alternativo): el alt de una foto que no está no describe nada.
    if (typeof record.url === "string" && referencesOrganizationMedia(record.url, organizationId)) return REMOVE;
    const copy: Record<string, unknown> = {};
    let touched = false;
    for (const [key, child] of Object.entries(record)) {
      const result = strip(child, organizationId, counter);
      if (result === REMOVE) {
        counter.removed += 1;
        touched = true;
      } else if (result === EMPTIED) touched = true;
      else copy[key] = result;
    }
    // Un objeto que ya venía vacío se respeta; uno que quedó vacío por la limpieza (p. ej. `openGraph` con solo su imagen) se descarta.
    return touched && Object.keys(copy).length === 0 ? EMPTIED : copy;
  }
  return value;
}

/** Quita de un valor cualquier archivo de la biblioteca del origen. `value` es `undefined` si lo que se quitó era el valor entero. */
export function stripSourceMedia(value: unknown, organizationId: string): { value: unknown; removed: number } {
  const counter = { removed: 0 };
  const result = strip(value, organizationId, counter);
  if (result === REMOVE) return { value: undefined, removed: counter.removed + 1 };
  if (result === EMPTIED) return { value: undefined, removed: counter.removed };
  return { value: result, removed: counter.removed };
}

// ---- referencias a recursos propios del negocio ------------------------------------------------------------------

/**
 * Los bloques que apuntan a un formulario, servicios o productos del negocio origen pierden la referencia: quedan en su estado
 * «sin configurar» (formulario vacío, o todos los servicios/productos del sitio nuevo). No se copia ningún recurso.
 */
export function clearBlockReferences(type: string, config: Record<string, unknown>): { config: Record<string, unknown>; cleared: number } {
  const copy = { ...config };
  let cleared = 0;
  const drop = (key: string) => {
    if (key in copy && copy[key] !== undefined && copy[key] !== null) cleared += 1;
    delete copy[key];
  };
  if (type === "contact_form") {
    if (copy.formId !== null && copy.formId !== undefined) cleared += 1;
    copy.formId = null;
  } else if (type === "booking") {
    drop("serviceIds");
  } else if (type === "catalog") {
    drop("productIds");
    drop("categoryId");
  }
  return { config: copy, cleared };
}

export type BlockSkipReason = "unknown_type" | "future_version" | "invalid_after_cleanup";

export type PreparedBlock =
  | { outcome: "copied"; config: Record<string, unknown>; imagesRemoved: number; referencesCleared: number }
  | { outcome: "skipped"; reason: BlockSkipReason };

/** Deja un bloque listo para vivir en otra organización, o explica por qué no se puede copiar. */
export function prepareBlockForDuplicate(input: { type: string; schemaVersion: number; config: unknown; sourceOrganizationId: string }): PreparedBlock {
  const definition = getBlockDefinition(input.type);
  if (!definition) return { outcome: "skipped", reason: "unknown_type" };
  if (input.schemaVersion > definition.version) return { outcome: "skipped", reason: "future_version" };
  if (input.config === null || typeof input.config !== "object" || Array.isArray(input.config)) return { outcome: "skipped", reason: "invalid_after_cleanup" };

  const stripped = stripSourceMedia(input.config, input.sourceOrganizationId);
  // El bloque entero era un archivo del origen (p. ej. un bloque de imagen): sin él no queda nada que copiar.
  if (stripped.value === undefined || typeof stripped.value !== "object" || stripped.value === null) return { outcome: "skipped", reason: "invalid_after_cleanup" };

  const cleaned = clearBlockReferences(input.type, stripped.value as Record<string, unknown>);
  // El resultado tiene que seguir siendo una configuración válida de ese bloque; si no, no se copia a medias.
  if (!definition.schema.safeParse(cleaned.config).success) return { outcome: "skipped", reason: "invalid_after_cleanup" };
  return { outcome: "copied", config: cleaned.config, imagesRemoved: stripped.removed, referencesCleared: cleaned.cleared };
}

// ---- SEO, fondo, Smart CTA y marca ---------------------------------------------------------------------------------

/** El SEO conserva textos, robots y el canonical (por slug de página, que no cambia); pierde la imagen del origen. */
export function prepareSeoMeta(seoMeta: unknown, sourceOrganizationId: string): { value: Record<string, unknown> | null; imagesRemoved: number } {
  if (seoMeta === null || seoMeta === undefined) return { value: null, imagesRemoved: 0 };
  const stripped = stripSourceMedia(seoMeta, sourceOrganizationId);
  if (stripped.value === undefined || typeof stripped.value !== "object" || stripped.value === null) return { value: null, imagesRemoved: stripped.removed };
  const parsed = seoMetaSchema.safeParse(stripped.value);
  return parsed.success ? { value: stripped.value as Record<string, unknown>, imagesRemoved: stripped.removed } : { value: null, imagesRemoved: stripped.removed };
}

/** El fondo (imagen o video de la biblioteca) se descarta si apunta a un archivo del origen; los degradados y colores se conservan. */
export function prepareBackground(background: unknown, sourceOrganizationId: string): { value: unknown; imagesRemoved: number } {
  if (background === null || background === undefined) return { value: null, imagesRemoved: 0 };
  return referencesOrganizationMedia(JSON.stringify(background), sourceOrganizationId) ? { value: null, imagesRemoved: 1 } : { value: background, imagesRemoved: 0 };
}

/**
 * Las reglas del Smart CTA apuntan a bloques por su id: se rehacen con los ids de los bloques nuevos y se descartan las que
 * apuntaban a un bloque que no se copió. Sin reglas, `null`.
 */
export function remapSmartCta(smartCta: unknown, blockIdMap: ReadonlyMap<string, string>): { value: { rules: Array<{ condition: unknown; blockId: string }> } | null; kept: number; dropped: number } {
  const parsed = smartCtaSchema.safeParse(smartCta);
  if (!parsed.success) return { value: null, kept: 0, dropped: 0 };
  const rules: Array<{ condition: unknown; blockId: string }> = [];
  let dropped = 0;
  for (const rule of parsed.data.rules) {
    const target = blockIdMap.get(rule.blockId);
    if (target) rules.push({ condition: rule.condition, blockId: target });
    else dropped += 1;
  }
  return { value: rules.length > 0 ? { rules } : null, kept: rules.length, dropped };
}

/** Qué revisar antes de publicar la copia, sin repetir y en orden estable. */
export function reviewHintsFor(blockTypes: readonly string[]): string[] {
  const hints: string[] = [];
  for (const type of blockTypes) {
    const hint = REVIEW_HINT_BY_BLOCK[type];
    if (hint && !hints.includes(hint)) hints.push(hint);
  }
  return hints;
}
