import { sanitizeRichText } from "../lib/sanitize.js";

/**
 * Único punto del render público que inserta HTML tal cual del contenido del sitio (no confundir
 * con `apps/web/components/json-ld.tsx`, que también usa `dangerouslySetInnerHTML` pero para JSON
 * escapado, no HTML) — y solo después de pasar por la segunda pasada de saneo (`lib/sanitize.ts`,
 * defensa en profundidad sobre lo que apps/api ya saneó al guardar). Ningún bloque debe insertar
 * HTML de usuario por otra vía.
 */
export function RichText({ html, className = "" }: { html: string; className?: string }) {
  return (
    <div
      className={`prose-content max-w-none text-[var(--site-color-foreground)] ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }}
    />
  );
}
