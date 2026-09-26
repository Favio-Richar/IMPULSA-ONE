"use client";

import { ArrowUpRight, CalendarCheck, MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";
import type { PrimaryAction } from "../lib/primary-action.js";
import { NetworkIcon } from "./network-icon.js";
import { OUTBOUND_LINK } from "./outbound.js";
import { stackSurfaceClass } from "./stack-button.js";

/**
 * Acción principal fija abajo en el teléfono (PP5).
 *
 * - `position: sticky` al final del contenido, no `fixed`: mientras se desplaza queda pegada al
 *   borde inferior, y al llegar al final se asienta en su propio lugar, así que **nunca tapa** el
 *   último bloque ni el pie. Funciona igual dentro del marco de la vista previa del constructor.
 * - Solo en pantallas angostas, por *container query* (`@min-[40rem]:hidden`, el mismo corte que
 *   `sm`): la vista previa del constructor, que simula un teléfono con un marco angosto dentro de
 *   una ventana ancha, la muestra igual que un teléfono real.
 * - Se esconde mientras el bloque original está a la vista (dos botones iguales a la vez no ayudan)
 *   y, escondida, es `inert`: el teclado y el lector de pantalla no llegan a un botón invisible.
 *   Sin JavaScript (o sin `IntersectionObserver`) queda siempre visible, que es lo seguro.
 * - `data-block-*` del bloque principal: el rastreador de analítica atribuye el clic a ese bloque
 *   sin saber que existe esta barra (F3.6).
 */
export function PrimaryActionBar({
  action,
  position,
  type,
  targetId,
  mono = false,
}: {
  action: PrimaryAction;
  position: number;
  type: string;
  targetId: string;
  /** Botones monocromo (PL7): la barra lleva la superficie neutra del tema, como el botón original. */
  mono?: boolean;
}) {
  const [targetVisible, setTargetVisible] = useState(false);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setTargetVisible(entry?.isIntersecting ?? false), {
      threshold: 0.6,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId]);

  return (
    <div
      data-primary-action-bar=""
      data-block-position={position}
      data-block-type={type}
      data-state={targetVisible ? "hidden" : "visible"}
      aria-hidden={targetVisible || undefined}
      inert={targetVisible || undefined}
      className={`sticky bottom-0 z-20 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none @min-[40rem]:hidden ${
        targetVisible ? "pointer-events-none translate-y-4 opacity-0" : "opacity-100"
      }`}
    >
      <a
        href={action.href}
        {...(action.external ? OUTBOUND_LINK : {})}
        // Un formulario principal está plegado (PP8): además de llevar hasta él, se abre.
        onClick={action.external ? undefined : () => document.getElementById(targetId)?.querySelector("details")?.setAttribute("open", "")}
        className={`flex min-h-12 w-full items-center justify-center gap-2 px-5 py-3 text-base font-semibold shadow-[0_6px_20px_-6px_rgb(15_23_42/0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 ${
          mono
            ? stackSurfaceClass("secondary")
            : "rounded-[var(--site-radius)] border border-transparent bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]"
        }`}
      >
        <ActionIcon icon={action.icon} />
        <span className="truncate">{action.label}</span>
      </a>
    </div>
  );
}

function ActionIcon({ icon }: { icon: PrimaryAction["icon"] }) {
  if (icon === "whatsapp") {
    return <NetworkIcon network="whatsapp" className="h-5 w-5 shrink-0" />;
  }
  if (icon === "form") {
    return <MessageSquareText className="h-5 w-5 shrink-0" aria-hidden="true" />;
  }
  if (icon === "booking") {
    return <CalendarCheck className="h-5 w-5 shrink-0" aria-hidden="true" />;
  }
  if (icon === "link") {
    return <ArrowUpRight className="h-5 w-5 shrink-0" aria-hidden="true" />;
  }
  return <NetworkIcon network={icon.network} className="h-5 w-5 shrink-0" />;
}
