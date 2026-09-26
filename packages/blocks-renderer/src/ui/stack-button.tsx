import type { ReactNode } from "react";
import { PRIMARY_ACTION_HALO } from "./link-button.js";
import { SURFACE_SCOPE } from "./surface.js";

export type StackButtonVariant = "primary" | "secondary" | "outline" | "glass";

/**
 * Geometría única de los botones de la página de enlaces (PP8): todos del mismo alto, a lo ancho de
 * la columna, con el texto centrado y el ícono fijo a la izquierda — la lista se lee como una pila
 * pareja y no como botones de tamaños distintos. El radio, la sombra y los colores son los del tema
 * (bordes moderados, sombras discretas: identidad propia, no la de otra plataforma).
 */
export function stackButtonClass(variant: StackButtonVariant, primary = false): string {
  const colors =
    variant === "glass"
      ? // PL5 (ADR-008): translúcido sobre foto o fondo oscuro. Tinte = texto de la página al 12 %
        // (`GLASS_ALPHA` en `@impulza/validation`); la matriz tema × fondo verifica AA con la mezcla.
        "border border-[color-mix(in_srgb,var(--site-color-foreground)_24%,transparent)] bg-[color-mix(in_srgb,var(--site-color-foreground)_12%,transparent)] text-[var(--site-color-foreground)] backdrop-blur-sm"
      : variant === "outline"
      ? "border border-[var(--site-color-link)] bg-transparent text-[var(--site-color-link)]"
      : variant === "secondary"
        ? `${SURFACE_SCOPE} border border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-[var(--site-color-foreground)]`
        : "border border-transparent bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]";
  return [
    "relative flex w-full items-center justify-center rounded-[var(--site-radius)] px-14 text-center shadow-[var(--site-shadow)]",
    "transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100",
    "focus-visible:outline-2 focus-visible:outline-offset-2",
    primary ? `min-h-16 py-3.5 ${PRIMARY_ACTION_HALO}` : "min-h-14 py-3",
    colors,
  ].join(" ");
}

/** Contenido de un botón de la pila: ícono a la izquierda, texto (y descripción) centrados. */
export function StackButtonContent({
  icon,
  label,
  description,
  primary = false,
}: {
  icon: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  primary?: boolean;
}) {
  return (
    <>
      <span className="absolute left-5 top-1/2 flex -translate-y-1/2 items-center">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className={primary ? "text-base font-semibold" : "font-medium"}>{label}</span>
        {/* Mismo color que el título: bajar la opacidad le quitaba contraste que nadie verificaba. */}
        {description ? <span className="text-sm">{description}</span> : null}
      </span>
    </>
  );
}
