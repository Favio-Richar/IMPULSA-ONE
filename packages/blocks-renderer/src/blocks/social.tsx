import type { SocialBlockConfig } from "@impulza/validation";
import { SocialButtonLinks } from "../ui/social-button-links.js";
import { SocialIconLinks } from "../ui/social-icon-links.js";

/**
 * Redes: por defecto una pila de botones con el logo de cada red (ADR-008); el estilo "íconos"
 * queda solo para quien lo elija a mano en el constructor.
 */
export function SocialBlock({ config, glass = false }: { config: SocialBlockConfig; glass?: boolean }) {
  if (config.style === "icons") {
    return <SocialIconLinks links={config.links} />;
  }
  return <SocialButtonLinks links={config.links} glass={glass} />;
}
