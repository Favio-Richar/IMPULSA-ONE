import { ExternalLink } from "lucide-react";
import type { LinkBlockConfig } from "@impulza/validation";

/**
 * `icon` es un valor de la lista blanca de redes (F2.4) pero lucide-react 1.46 no trae logos de
 * marca (Instagram, TikTok, etc. — los retiró por marca registrada). En vez de inventar un ícono
 * que no es el correcto, se usa uno solo, genérico, para todo enlace: es honesto y consistente. Un
 * ícono de marca exacto es una mejora de una fase posterior con una librería de íconos aparte.
 */
export function LinkBlock({ config }: { config: LinkBlockConfig }) {
  const isOutline = config.style === "outline";
  const isSecondary = config.style === "secondary";

  return (
    <a
      href={config.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={`flex items-center gap-3 rounded-[var(--site-radius)] px-5 py-4 shadow-[var(--site-shadow)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 ${
        isOutline
          ? "border border-[var(--site-color-primary)] bg-transparent text-[var(--site-color-primary)]"
          : isSecondary
            ? "border border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-[var(--site-color-foreground)]"
            : "border border-transparent bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]"
      }`}
    >
      <ExternalLink className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-left">
        <span className="block font-medium">{config.label}</span>
        {config.description ? (
          <span className="block text-sm opacity-80">{config.description}</span>
        ) : null}
      </span>
    </a>
  );
}
