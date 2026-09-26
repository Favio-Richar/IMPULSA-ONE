import type { SocialBlockConfig } from "@impulza/validation";
import { NETWORK_LABELS, NetworkIcon } from "./network-icon.js";
import { OUTBOUND_LINK } from "./outbound.js";
import { StackButtonContent, stackButtonClass } from "./stack-button.js";

type SocialLink = SocialBlockConfig["links"][number];

/**
 * Redes como botones de la pila de enlaces (ADR-008, corrección del 2026-09-26): cada red es un
 * botón a lo ancho, del mismo alto que los demás enlaces, con su logo a la izquierda y el nombre de
 * la red centrado — el patrón de las apps de enlace en bio que pidió Favio, no una fila de íconos.
 * Compartido por el bloque "redes" y el encabezado de perfil. Con un tema "glass", translúcidos.
 */
export function SocialButtonLinks({ links, glass = false }: { links: readonly SocialLink[]; glass?: boolean }) {
  return (
    <ul className="flex w-full flex-col gap-3">
      {links.map((link, index) => (
        <li key={`${link.network}-${index}`}>
          <a href={link.url} {...OUTBOUND_LINK} className={stackButtonClass(glass ? "glass" : "secondary")}>
            <StackButtonContent icon={<NetworkIcon network={link.network} className="h-5 w-5 shrink-0" />} label={NETWORK_LABELS[link.network]} />
          </a>
        </li>
      ))}
    </ul>
  );
}
