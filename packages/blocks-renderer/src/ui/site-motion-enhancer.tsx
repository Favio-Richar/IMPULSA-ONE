"use client";

import { useEffect } from "react";

/**
 * Microinteracciones del movimiento elegante (F10), sin dependencias: la acción principal se acerca suavemente al
 * cursor (efecto «magnético») y las tarjetas de colecciones se inclinan un par de grados hacia donde apunta el mouse.
 * Es el mismo patrón del «Magnetic Button» del catálogo de 21st.dev, pero con un único oyente de eventos y CSS, sin
 * `framer-motion`: la página pública no carga una librería de animación para un efecto de 8 píxeles.
 *
 * Solo con mouse real (no en pantallas táctiles) y nunca con «reducir movimiento». No hace nada fuera de los
 * elementos marcados (`[data-primary-action]` y `[data-tilt]`).
 */
const TARGETS = "[data-primary-action] a, [data-primary-action] button, [data-tilt]";

export function SiteMotionEnhancer() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hasHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (reduced || !hasHover) return;
    const root = document.querySelector<HTMLElement>("[data-site-root]");
    if (!root) return;

    let active: HTMLElement | null = null;
    const reset = (element: HTMLElement): void => {
      element.style.transform = "";
    };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      const target = (event.target as Element | null)?.closest<HTMLElement>(TARGETS) ?? null;
      if (active && active !== target) {
        reset(active);
        active = null;
      }
      if (!target) return;
      if (active !== target) {
        active = target;
        target.style.transition = "transform 180ms cubic-bezier(0.2, 0.7, 0.2, 1)";
        target.style.willChange = "transform";
      }
      const rect = target.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2)));
      const y = Math.max(-1, Math.min(1, (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2)));
      target.style.transform = target.hasAttribute("data-tilt")
        ? `perspective(900px) rotateX(${(-y * 3).toFixed(2)}deg) rotateY(${(x * 3).toFixed(2)}deg)`
        : `translate(${(x * 6).toFixed(1)}px, ${(y * 4).toFixed(1)}px)`;
    };
    const onLeave = (): void => {
      if (active) reset(active);
      active = null;
    };

    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      onLeave();
    };
  }, []);

  return null;
}
