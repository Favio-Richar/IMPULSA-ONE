import { Users } from "lucide-react";
import { subscribePath, type SubscribeBlockConfig } from "@impulza/validation";
import type { ButtonVariant } from "../ui/link-button.js";
import { StackButtonContent, stackButtonClass } from "../ui/stack-button.js";

/**
 * Botón «Suscribirme» del portal (extra F10, ADR-029): UN botón de la pila, nada más. No lleva formulario ni cifras: lleva a la
 * página de suscripción del sitio (`/:sitio/s`), que el negocio personaliza y donde la persona se suscribe gratis o con un plan
 * de pago. Es un enlace común (`<a>`), como el resto de la pila.
 */
export function SubscribeBlock({
  config,
  siteSlug,
  buttonVariant,
  mono = false,
}: {
  config: SubscribeBlockConfig;
  siteSlug?: string;
  /** Estilo de botones del tema (ya resuelto por la página: la acción principal gana en sólido). */
  buttonVariant: ButtonVariant;
  /** Botones monocromo (PL7): todo con la superficie neutra. */
  mono?: boolean;
}) {
  const variant = mono ? "secondary" : buttonVariant;
  return (
    <a href={siteSlug ? subscribePath(siteSlug) : "#"} className={stackButtonClass(variant)} data-subscribe="">
      <StackButtonContent icon={<Users className="h-5 w-5 shrink-0" aria-hidden="true" />} label={config.label} description={config.description} />
    </a>
  );
}
