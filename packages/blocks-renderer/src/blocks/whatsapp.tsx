"use client";

import { MessageCircle } from "lucide-react";
import type { WhatsappBlockConfig } from "@impulza/validation";
import { LinkButton, type ButtonVariant } from "../ui/link-button.js";

/**
 * F3.4: el clic dispara un registro de analítica (`whatsapp_click`) sin bloquear ni retrasar la
 * navegación real al chat — nunca `preventDefault` ni una redirección por JavaScript: sigue
 * siendo un `<a href>` de verdad (abre en pestaña nueva, se puede copiar el enlace, clic central
 * funciona). `keepalive: true` deja que el `fetch` termine aunque esta pestaña navegue afuera de
 * inmediato. Pasa por la ruta propia de `apps/web` (nunca `apps/api` directo desde el navegador,
 * mismo principio que `ContactFormBlock`).
 */
export function WhatsappBlock({
  config,
  buttonVariant,
  siteSlug,
  mode = "public",
}: {
  config: WhatsappBlockConfig;
  buttonVariant: ButtonVariant;
  siteSlug?: string;
  mode?: "public" | "preview";
}) {
  // wa.me quiere el número sin "+" ni separadores; `phone` ya está en E.164 (F2.4).
  const digits = config.phone.replace(/\D/g, "");
  const query = config.prefilledMessage ? `?text=${encodeURIComponent(config.prefilledMessage)}` : "";

  function trackClick(): void {
    if (mode !== "public" || !siteSlug) {
      return;
    }
    try {
      void fetch(`/api/analytics/${encodeURIComponent(siteSlug)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one" },
        body: JSON.stringify({ type: "whatsapp_click" }),
        keepalive: true,
      });
    } catch {
      // El clic real a WhatsApp nunca depende de que esto funcione — es una métrica, no una
      // condición para navegar.
    }
  }

  // El verde oficial de WhatsApp (#25D366) con texto blanco da 1.98:1 de contraste — muy por
  // debajo del 4.5:1 que exige WCAG 2.2 AA. El objetivo de accesibilidad del proyecto no se
  // negocia por reconocimiento de marca: se usa el color del tema (ya verificado en servidor
  // contra AA, F2.5), y el ícono hace el trabajo de reconocimiento.
  return (
    <LinkButton href={`https://wa.me/${digits}${query}`} variant={buttonVariant} block onClick={trackClick}>
      <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
      {config.label}
    </LinkButton>
  );
}
