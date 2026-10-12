import type { ReactNode } from "react";

const MAX_WIDTHS = { md: "40rem", lg: "56rem", xl: "64rem" } as const;

/**
 * Saca un bloque de la columna angosta de la página pública para que respire en pantallas anchas (álbumes, colecciones,
 * cifras). En la vista previa del constructor se queda dentro de su marco. Con un teléfono no cambia nada: el ancho es
 * el de la columna (`100vw - 2rem` nunca supera al ancho disponible).
 */
export function WideBleed({ mode = "public", size = "lg", children }: { mode?: "public" | "preview"; size?: keyof typeof MAX_WIDTHS; children: ReactNode }) {
  if (mode !== "public") return <div className="@container w-full">{children}</div>;
  return (
    <div className="@container relative left-1/2 -translate-x-1/2" style={{ width: `min(calc(100vw - 2rem), ${MAX_WIDTHS[size]})` }}>
      {children}
    </div>
  );
}
