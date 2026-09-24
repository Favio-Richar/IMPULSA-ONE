import { ExternalLink } from "lucide-react";
import type { LinkBlockConfig } from "@impulza/validation";
import { NetworkIcon } from "../ui/network-icon.js";

/**
 * `icon` (opcional) es una red de la lista blanca (F2.4): si viene, el enlace muestra el logo de
 * esa red; si no, el ícono genérico de enlace externo.
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
      {config.icon ? (
        <NetworkIcon network={config.icon} className="h-5 w-5 shrink-0" />
      ) : (
        <ExternalLink className="h-5 w-5 shrink-0" aria-hidden="true" />
      )}
      <span className="flex-1 text-left">
        <span className="block font-medium">{config.label}</span>
        {config.description ? (
          <span className="block text-sm opacity-80">{config.description}</span>
        ) : null}
      </span>
    </a>
  );
}
