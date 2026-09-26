import { ExternalLink } from "lucide-react";
import { detectSocialNetwork, type LinkBlockConfig } from "@impulza/validation";
import { NetworkIcon } from "../ui/network-icon.js";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { ShareButton } from "../ui/share-button.js";
import { StackButtonContent, stackButtonClass, stackTextClass } from "../ui/stack-button.js";

/**
 * Un botón de la pila de enlaces (PP8). `icon` (opcional) es una plataforma de la lista blanca
 * (F2.4): si viene, el botón muestra su logo; si no, el de la plataforma que se reconoce en el
 * enlace; y si no es de ninguna conocida, el ícono genérico de enlace.
 */
export function LinkBlock({
  config,
  primary = false,
  glass = false,
  mono = false,
}: {
  config: LinkBlockConfig;
  primary?: boolean;
  glass?: boolean;
  /** Botones monocromo (PL7): todo con la superficie neutra, también la acción principal. */
  mono?: boolean;
}) {
  // La acción principal (PP5) siempre va sólida y más alta, sea cual sea el estilo elegido. Con un
  // tema "glass" (PL5), los enlaces secundarios son translúcidos.
  const variant = mono ? "secondary" : primary ? "primary" : glass && config.style === "secondary" ? "glass" : config.style;
  // PP8: sin ícono elegido, el de la plataforma del enlace (`instagram.com/...` → Instagram).
  const network = config.icon ?? detectSocialNetwork(config.url);

  const link = (
    <a href={config.url} {...OUTBOUND_LINK} className={stackButtonClass(variant, primary)}>
      <StackButtonContent
        primary={primary}
        icon={
          network ? (
            <NetworkIcon network={network} className="h-5 w-5 shrink-0" />
          ) : (
            <ExternalLink className="h-5 w-5 shrink-0" aria-hidden="true" />
          )
        }
        label={config.label}
        description={config.description}
      />
    </a>
  );

  if (!config.shareable) {
    return link;
  }
  // PL8: el botón de compartir va junto al enlace, no dentro (un control, un destino), sobre el
  // costado derecho que el botón de la pila ya deja libre (`px-14`).
  return (
    <div className="relative">
      {link}
      <ShareButton
        url={config.url}
        title={config.label}
        label={`Compartir ${config.label}`}
        className={`absolute right-2 top-1/2 -translate-y-1/2 ${stackTextClass(variant)}`}
      />
    </div>
  );
}
