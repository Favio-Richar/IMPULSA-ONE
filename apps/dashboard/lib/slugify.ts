/**
 * Sugerencia de slug a partir de un nombre ("Café Aroma & Co." → "cafe-aroma-co"). Solo una
 * sugerencia editable: la regla real (formato y nombres reservados) la aplican `publicSlugSchema` en
 * el formulario y otra vez la API al crear el sitio.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}
