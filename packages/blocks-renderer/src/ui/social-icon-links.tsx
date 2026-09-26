import type { SocialBlockConfig } from "@impulza/validation";
import { NETWORK_LABELS, NetworkIcon } from "./network-icon.js";
import { SURFACE_SCOPE } from "./surface.js";

type SocialLink = SocialBlockConfig["links"][number];

/**
 * Fila de redes con su logo real (`simple-icons`), compartida por el bloque "redes" en estilo
 * íconos y por el encabezado de perfil (PP4). Cada enlace es un círculo de 44 px (tamaño de toque
 * WCAG 2.5.8 con holgura) sobre la superficie del tema, así que se lee igual sobre un fondo de
 * página oscuro (PP3). El nombre de la red va en `aria-label`: el ícono solo no se anuncia.
 */
export function SocialIconLinks({ links, className = "" }: { links: readonly SocialLink[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center justify-center gap-3 ${className}`}>
      {links.map((link, index) => (
        <li key={`${link.network}-${index}`}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={NETWORK_LABELS[link.network]}
            className={`${SURFACE_SCOPE} flex h-11 w-11 items-center justify-center rounded-full border border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-[var(--site-color-foreground)] shadow-[var(--site-shadow)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2`}
          >
            <NetworkIcon network={link.network} className="h-5 w-5 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}
