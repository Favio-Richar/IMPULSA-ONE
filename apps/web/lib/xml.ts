// Escapa los cinco caracteres que XML no puede llevar crudos dentro de texto o atributos. Se usa
// para `sitemap.xml` (F2.8): aunque hoy `<loc>` solo lleva slugs ya validados (sin `&`, `<`, etc.),
// escapar no es opcional "por si acaso" — es la misma disciplina de "nunca confiar en que el dato
// de entrada ya viene limpio" que el resto del proyecto aplica a HTML (ST §22).
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
