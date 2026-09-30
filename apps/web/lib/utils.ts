/**
 * Une clases condicionales (convención de los componentes de `components/ui`, estilo shadcn). Sin
 * dependencias: estos componentes no combinan utilidades de Tailwind en conflicto, así que no hace
 * falta `tailwind-merge`.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
