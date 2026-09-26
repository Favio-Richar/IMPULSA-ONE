import { NetworkIcon } from "../ui/network-icon.js";
import type { WhatsappBlockConfig } from "@impulza/validation";
import { whatsappHref } from "../lib/primary-action.js";
import { LinkButton, type ButtonVariant } from "../ui/link-button.js";

/**
 * F3.4: el clic a WhatsApp se mide como `whatsapp_click`. Desde F3.6 lo registra el rastreador
 * único del sitio público (`apps/web/components/analytics-tracker.tsx`, por delegación sobre
 * `data-block-type="whatsapp"`), no este componente — un solo lugar que decide qué es un clic,
 * con idempotencia y atribución al bloque, en vez de un `fetch` propio por tipo de bloque. Sigue
 * siendo un `<a href>` de verdad: nunca `preventDefault` ni una redirección por JavaScript.
 */
export function WhatsappBlock({
  config,
  buttonVariant,
  primary = false,
}: {
  config: WhatsappBlockConfig;
  buttonVariant: ButtonVariant;
  /** Acción principal de la página (PP5): botón sólido y más grande, sin importar el tema. */
  primary?: boolean;
}) {
  // El verde oficial de WhatsApp (#25D366) con texto blanco da 1.98:1 de contraste — muy por
  // debajo del 4.5:1 que exige WCAG 2.2 AA. El objetivo de accesibilidad del proyecto no se
  // negocia por reconocimiento de marca: se usa el color del tema (ya verificado en servidor
  // contra AA, F2.5), y el ícono hace el trabajo de reconocimiento.
  return (
    <LinkButton
      href={whatsappHref(config.phone, config.prefilledMessage)}
      variant={primary ? "primary" : buttonVariant}
      size={primary ? "lg" : "md"}
      block
    >
      <NetworkIcon network="whatsapp" className="h-5 w-5 shrink-0" />
      {config.label}
    </LinkButton>
  );
}
