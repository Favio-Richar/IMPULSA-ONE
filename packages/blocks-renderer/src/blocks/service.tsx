import { Tag } from "lucide-react";
import type { ServiceBlockConfig } from "@impulza/validation";
import type { ButtonVariant } from "../ui/link-button.js";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { SiteImage } from "../ui/site-image.js";
import { StackButtonContent, stackButtonClass } from "../ui/stack-button.js";
import { formatPrice } from "../lib/format-price.js";

/**
 * Servicio como un botón más de la pila de enlaces (PL5: "nunca como una tarjeta aparte con su
 * propio mini-botón"): miniatura o ícono a la izquierda, nombre centrado y debajo el precio y la
 * acción ("$12.000 · Reservar"). Todo el botón lleva al destino de la acción; sin acción, es una
 * fila informativa con la misma geometría. La descripción larga no cabe en un botón y no se pinta
 * acá (sigue guardada en el bloque).
 */
export function ServiceBlock({ config, buttonVariant }: { config: ServiceBlockConfig; buttonVariant: ButtonVariant }) {
  const price =
    config.priceAmount !== undefined && config.priceCurrency ? formatPrice(config.priceAmount, config.priceCurrency) : null;
  const detail = [price, config.cta?.label].filter(Boolean).join(" · ");
  const icon = config.image ? (
    <SiteImage image={config.image} sizes="40px" width={40} height={40} className="h-10 w-10 shrink-0 rounded-[calc(var(--site-radius)/2)] object-cover" />
  ) : (
    <Tag className="h-5 w-5 shrink-0" aria-hidden="true" />
  );
  const className = stackButtonClass(buttonVariant === "glass" ? "glass" : "secondary");
  const content = <StackButtonContent icon={icon} label={config.name} description={detail || undefined} />;

  return config.cta ? (
    <a href={config.cta.url} {...OUTBOUND_LINK} className={className} data-service-button="">
      {content}
    </a>
  ) : (
    <div className={className} data-service-button="">
      {content}
    </div>
  );
}
