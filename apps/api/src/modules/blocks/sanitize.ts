import { getBlockDefinition } from "@impulza/validation";
import sanitizeHtml from "sanitize-html";

/**
 * Lista blanca de etiquetas y atributos del texto enriquecido (F2.4). Es deliberadamente corta:
 * lo que el constructor puede producir con Tiptap y nada más. Todo lo que no esté acá se elimina,
 * incluidos `<script>`, `<iframe>`, `<style>`, `<form>` y cualquier atributo `on*`.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h2",
    "h3",
    "h4",
    "a",
    "code",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  // Mismo criterio que safeUrlSchema: un `href` es un enlace, no una vía de ejecución.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesAppliedToAttributes: ["href"],
  // Un enlace a otro dominio que abre en pestaña nueva sin `noopener` deja al sitio destino
  // manipular la ventana original (tabnabbing). Se fuerza siempre, no se confía en el editor.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer nofollow" },
    }),
  },
  // Sin esto, `<p>a < b</p>` u otros restos quedarían como texto suelto fuera de etiquetas.
  disallowedTagsMode: "discard",
};

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value, SANITIZE_OPTIONS);
}

/**
 * Aplica una función a la ruta indicada dentro de `target`, mutando una copia.
 * Sintaxis soportada (la misma que declara el catálogo): `campo`, `campo.sub`, `lista[].campo`.
 */
function applyAtPath(target: unknown, segments: string[], transform: (value: string) => string): void {
  if (target === null || typeof target !== "object" || segments.length === 0) {
    return;
  }

  const [head, ...rest] = segments as [string, ...string[]];
  const isArrayStep = head.endsWith("[]");
  const key = isArrayStep ? head.slice(0, -2) : head;
  const container = target as Record<string, unknown>;
  const value = container[key];

  if (value === undefined || value === null) {
    return;
  }

  if (isArrayStep) {
    if (!Array.isArray(value)) {
      return;
    }
    for (const item of value) {
      applyAtPath(item, rest, transform);
    }
    return;
  }

  if (rest.length === 0) {
    if (typeof value === "string") {
      container[key] = transform(value);
    }
    return;
  }

  applyAtPath(value, rest, transform);
}

/**
 * Sanitiza **toda** la configuración de un bloque según lo que declare su entrada del catálogo.
 * Está dirigido por datos a propósito: no hay código por tipo que alguien pueda olvidar escribir
 * al agregar un bloque nuevo, y una prueba en `packages/validation` verifica que las rutas
 * declaradas sean exactamente los campos de texto enriquecido del esquema.
 *
 * Se llama **después** de validar con Zod y **antes** de persistir.
 */
export function sanitizeBlockConfig<T>(type: string, config: T): T {
  const definition = getBlockDefinition(type);

  if (!definition || definition.richTextPaths.length === 0) {
    return config;
  }

  // Copia profunda para no mutar el objeto que devolvió Zod al llamador.
  const copy = structuredClone(config);

  for (const path of definition.richTextPaths) {
    applyAtPath(copy, path.split("."), sanitizeRichText);
  }

  return copy;
}
