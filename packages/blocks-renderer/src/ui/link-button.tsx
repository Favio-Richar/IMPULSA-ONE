import type { ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "outline";

interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  children: ReactNode;
  /** Ensancha el botón al 100% del contenedor — el bloque `link` siempre lo usa así. */
  block?: boolean;
  /** Instrumentación opcional (p. ej. registrar un clic de analítica, F3.4) — nunca controla la
   *  navegación en sí: el `href`/`target` de abajo hacen todo el trabajo real, esto solo observa. */
  onClick?: () => void;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)] border border-transparent hover:opacity-90",
  secondary:
    "bg-[var(--site-color-surface)] text-[var(--site-color-foreground)] border border-[var(--site-color-border)] hover:bg-[var(--site-color-border)]/30",
  outline:
    "bg-transparent text-[var(--site-color-primary)] border border-[var(--site-color-primary)] hover:bg-[var(--site-color-primary)]/10",
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
export function LinkButton({ href, variant = "primary", children, block = false, onClick }: LinkButtonProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--site-radius)] px-5 py-2.5 text-sm font-medium shadow-[var(--site-shadow)] transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 ${block ? "w-full" : ""} ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </a>
  );
}
