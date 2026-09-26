import type { ReactNode } from "react";
import { SURFACE_SCOPE } from "./surface.js";
import { OUTBOUND_LINK } from "./outbound.js";

export type ButtonVariant = "primary" | "secondary" | "outline";

interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  children: ReactNode;
  /** Ensancha el botón al 100% del contenedor — el bloque `link` siempre lo usa así. */
  block?: boolean;
  /** `lg` para la acción principal de la página (PP5), que además lleva el halo. */
  size?: "md" | "lg";
  /** Instrumentación opcional (p. ej. registrar un clic de analítica, F3.4) — nunca controla la
   *  navegación en sí: el `href`/`target` de abajo hacen todo el trabajo real, esto solo observa. */
  onClick?: () => void;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)] border border-transparent hover:opacity-90",
  secondary: `${SURFACE_SCOPE} bg-[var(--site-color-surface)] text-[var(--site-color-foreground)] border border-[var(--site-color-border)] hover:bg-[var(--site-color-border)]/30`,
  // `--site-color-link` y no el primario: sobre un fondo oscuro (PP3) el primario puede no leerse.
  outline:
    "bg-transparent text-[var(--site-color-link)] border border-[var(--site-color-link)] hover:bg-[var(--site-color-link)]/10",
};

/**
 * Único componente de botón del render público — todos los bloques con una llamada a la acción
 * (hero, service, link, whatsapp, contact_actions) pasan por acá, para que el radio, la sombra y
 * el tratamiento de foco sean consistentes en toda la página sin importar el bloque.
 *
 * Siempre `<a>`, nunca `<button>`: todo lo que este bloque puede hacer es enlazar a algo (una URL,
 * un `mailto:`, un `tel:`, un `https://wa.me/...`) — no hay una acción del lado del cliente que
 * decida la navegación. `onClick` (F3.4) es solo instrumentación opcional (analítica), nunca
 * `preventDefault`: el enlace real sigue siendo `href`/`target`, no algo que arme JavaScript.
 */
const SIZE_CLASSES: Record<NonNullable<LinkButtonProps["size"]>, string> = {
  md: "px-5 py-2.5 text-sm font-medium",
  lg: "min-h-14 px-6 py-3.5 text-base font-semibold",
};

/** Halo de la acción principal (PP5): la distingue de los demás botones sólidos sin animarse. */
export const PRIMARY_ACTION_HALO = "ring-4 ring-[var(--site-color-primary)]/20";

export function LinkButton({ href, variant = "primary", children, block = false, size = "md", onClick }: LinkButtonProps) {
  return (
    <a
      href={href}
      {...OUTBOUND_LINK}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--site-radius)] ${SIZE_CLASSES[size]} ${size === "lg" ? PRIMARY_ACTION_HALO : ""} shadow-[var(--site-shadow)] transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 ${block ? "w-full" : ""} ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </a>
  );
}
