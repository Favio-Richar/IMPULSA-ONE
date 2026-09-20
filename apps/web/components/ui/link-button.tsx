import type { ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "outline";

interface LinkButtonProps {
  href: string;
  variant?: ButtonVariant;
  children: ReactNode;
  /** Ensancha el botón al 100% del contenedor — el bloque `link` siempre lo usa así. */
  block?: boolean;
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
 * justifique JavaScript.
 */
export function LinkButton({ href, variant = "primary", children, block = false }: LinkButtonProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--site-radius)] px-5 py-2.5 text-sm font-medium shadow-[var(--site-shadow)] transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 ${block ? "w-full" : ""} ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </a>
  );
}
