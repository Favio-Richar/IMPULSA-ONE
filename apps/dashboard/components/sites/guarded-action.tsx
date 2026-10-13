"use client";

import { useId } from "react";

/**
 * Una acción que puede estar bloqueada con una explicación visible: cuando `reason` viene, el contenido (un botón ya deshabilitado)
 * se envuelve con un tooltip accesible (`role="tooltip"`, `aria-describedby`), que aparece al pasar el mouse o al enfocar. Un botón
 * deshabilitado no recibe foco, por eso el contenedor es el enfocable: así también se lee con teclado y lector de pantalla.
 */
export function GuardedAction({ reason, children }: { reason: string | null; children: React.ReactNode }): React.JSX.Element {
  const tooltipId = useId();
  if (!reason) return <>{children}</>;
  return (
    <span className="group relative inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]" tabIndex={0} aria-describedby={tooltipId}>
      {children}
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-64 rounded-md border border-border bg-foreground px-3 py-2 text-xs font-normal text-background shadow-lg group-hover:block group-focus:block group-focus-within:block"
      >
        {reason}
      </span>
    </span>
  );
}
