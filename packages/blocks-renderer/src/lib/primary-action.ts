import type { PublicBlockResponse } from "@impulza/contracts";
import { bookingBlockSchema, contactFormSchema, linkSchema, type SocialBlockConfig, whatsappSchema } from "@impulza/validation";

/** `id` del bloque principal en la página: ancla del formulario y objetivo del observador. */
export const PRIMARY_ACTION_ANCHOR = "accion-principal";

export type PrimaryActionIcon = "whatsapp" | "form" | "link" | "booking" | { network: SocialBlockConfig["links"][number]["network"] };

/** Lo que la barra fija del teléfono necesita para repetir la acción principal (PP5). */
export interface PrimaryAction {
  href: string;
  label: string;
  /** Un enlace a otro sitio abre en otra pestaña; el ancla al formulario, en la misma. */
  external: boolean;
  icon: PrimaryActionIcon;
}

/** Enlace de WhatsApp (bloque y barra fija): wa.me quiere el E.164 sin "+" ni separadores, más el mensaje precargado si hay. */
export function whatsappHref(phone: string, prefilledMessage?: string): string {
  const query = prefilledMessage ? `?text=${encodeURIComponent(prefilledMessage)}` : "";
  return `https://wa.me/${phone.replace(/\D/g, "")}${query}`;
}

/**
 * Traduce el bloque marcado como principal a la acción que repite la barra. `null` si no hay nada
 * accionable (un formulario todavía sin elegir): mejor no mostrar barra que un botón que no lleva
 * a ninguna parte. La configuración se vuelve a validar con el esquema de su tipo, igual que
 * `RenderBlock`.
 */
export function primaryActionOf(block: PublicBlockResponse): PrimaryAction | null {
  switch (block.type) {
    case "whatsapp": {
      const parsed = whatsappSchema.safeParse(block.config);
      return parsed.success
        ? { href: whatsappHref(parsed.data.phone, parsed.data.prefilledMessage), label: parsed.data.label, external: true, icon: "whatsapp" }
        : null;
    }
    case "link": {
      const parsed = linkSchema.safeParse(block.config);
      return parsed.success
        ? {
            href: parsed.data.url,
            label: parsed.data.label,
            external: true,
            icon: parsed.data.icon ? { network: parsed.data.icon } : "link",
          }
        : null;
    }
    case "contact_form": {
      const parsed = contactFormSchema.safeParse(block.config);
      if (!parsed.success || !parsed.data.formId) {
        return null;
      }
      return { href: `#${PRIMARY_ACTION_ANCHOR}`, label: parsed.data.title ?? "Escríbenos", external: false, icon: "form" };
    }
    case "booking": {
      // F5.2: como el formulario, un flujo plegado dentro de la página; la barra lleva hasta él y lo abre.
      const parsed = bookingBlockSchema.safeParse(block.config);
      return parsed.success ? { href: `#${PRIMARY_ACTION_ANCHOR}`, label: parsed.data.label, external: false, icon: "booking" } : null;
    }
    default:
      return null;
  }
}
