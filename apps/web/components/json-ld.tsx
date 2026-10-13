// Un `<script type="application/ld+json">` por nodo de datos estructurados (F11, "SEO avanzado").
// Server component puro: nada de esto depende del visitante, así que no hay nada que hidratar.

/**
 * `JSON.stringify` no escapa `<`: un nombre de negocio, pregunta de FAQ o nombre de servicio con
 * `</script><script>...` adentro cerraría este `<script>` antes de tiempo e inyectaría HTML/JS
 * propio (estos textos vienen de lo que el propietario del sitio escribió, no de un literal fijo
 * acá). `<` es indistinguible de `<` para un parser de JSON o de `application/ld+json`, pero
 * no cierra ninguna etiqueta — es la forma estándar de incrustar JSON en un `<script>` de HTML.
 */
function safeJsonLd(node: Record<string, unknown>): string {
  return JSON.stringify(node).replace(/</g, "\\u003c");
}

export function JsonLd({ nodes }: { nodes: Array<Record<string, unknown>> }) {
  return (
    <>
      {nodes.map((node, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(node) }} />
      ))}
    </>
  );
}
