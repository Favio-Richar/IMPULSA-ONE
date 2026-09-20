// Lista blanca de HTML permitido en un campo de texto enriquecido (F2.4). Isomorfa y sin la
// dependencia de `sanitize-html` en sí (que es de Node): solo los DATOS de la política, para que
// no puedan divergir entre los dos lugares que sanitizan HTML de usuario —
// `apps/api/src/modules/blocks/sanitize.ts` (al guardar, la autoridad real) y
// `apps/web/lib/sanitize.ts` (al renderizar en la página pública, defensa en profundidad: si algún
// día un bug deja pasar HTML sin sanitizar hasta la base, esta segunda pasada en el punto de mayor
// exposición —una página pública, sin sesión— sigue sin dejarlo ejecutar nada).
//
// Deliberadamente corta: es lo que el constructor puede producir con Tiptap y nada más. Todo lo
// que no esté acá se elimina, incluidos `<script>`, `<iframe>`, `<style>`, `<form>` y cualquier
// atributo `on*`.
export const RICH_TEXT_ALLOWED_TAGS = [
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
] as const;

export const RICH_TEXT_LINK_ATTRIBUTES = ["href", "target", "rel"] as const;

// Mismo criterio que `safeUrlSchema`: un `href` es un enlace, no una vía de ejecución. Sin
// `javascript:`, `data:` ni `vbscript:`.
export const RICH_TEXT_ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"] as const;
