import type { SocialBlockConfig } from "@impulza/validation";
import { NETWORK_LABELS, NetworkIcon } from "../ui/network-icon.js";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { SocialIconLinks } from "../ui/social-icon-links.js";
import { StackButtonContent, stackButtonClass } from "../ui/stack-button.js";

/** Redes: fila de íconos, o (estilo "botones") una pila de botones con el logo de cada red (PP8). */
export function SocialBlock({ config }: { config: SocialBlockConfig }) {
  if (config.style !== "buttons") {
    return <SocialIconLinks links={config.links} />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {config.links.map((link, index) => (
        <li key={`${link.network}-${index}`}>
          <a href={link.url} {...OUTBOUND_LINK} className={stackButtonClass("secondary")}>
            <StackButtonContent icon={<NetworkIcon network={link.network} className="h-5 w-5 shrink-0" />} label={NETWORK_LABELS[link.network]} />
          </a>
        </li>
      ))}
    </ul>
  );
}
