"use client";

import { MoreVertical } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Panel de acciones de una tarjeta (el de los tres puntos). Es un **disclosure**, no un menú ARIA: un botón con `aria-expanded` que
 * abre un grupo de enlaces y botones normales, navegables con Tab. (`role="menu"` exigiría además navegación por flechas, y mezclarlo
 * con la confirmación en línea de «Archivar» lo dejaría a medias.) Se cierra con Escape o al hacer clic fuera, y el foco vuelve al
 * botón al cerrar.
 */
export function SiteActionsMenu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      >
        <MoreVertical className="size-5" aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="group"
          aria-label={label}
          className="absolute right-0 top-11 z-30 flex min-w-52 flex-col gap-0.5 rounded-lg border border-border bg-background p-1.5 shadow-lg"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** Estilo común de un elemento del menú (enlace o botón). */
export const MENU_ITEM_CLASS =
  "flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-foreground transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";
