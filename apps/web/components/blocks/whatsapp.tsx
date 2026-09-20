import { MessageCircle } from "lucide-react";
import type { WhatsappBlockConfig } from "@impulza/validation";
import { LinkButton, type ButtonVariant } from "../ui/link-button";

export function WhatsappBlock({
  config,
  buttonVariant,
}: {
  config: WhatsappBlockConfig;
  buttonVariant: ButtonVariant;
}) {
  // wa.me quiere el número sin "+" ni separadores; `phone` ya está en E.164 (F2.4).
  const digits = config.phone.replace(/\D/g, "");
  const query = config.prefilledMessage ? `?text=${encodeURIComponent(config.prefilledMessage)}` : "";

  // El verde oficial de WhatsApp (#25D366) con texto blanco da 1.98:1 de contraste — muy por
  // debajo del 4.5:1 que exige WCAG 2.2 AA. El objetivo de accesibilidad del proyecto no se
  // negocia por reconocimiento de marca: se usa el color del tema (ya verificado en servidor
  // contra AA, F2.5), y el ícono hace el trabajo de reconocimiento.
  return (
    <LinkButton href={`https://wa.me/${digits}${query}`} variant={buttonVariant} block>
      <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
      {config.label}
    </LinkButton>
  );
}
