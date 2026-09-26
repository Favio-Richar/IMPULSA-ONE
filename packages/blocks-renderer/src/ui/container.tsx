import type { CSSProperties, ReactNode } from "react";

/**
 * Relleno horizontal fijo de toda la página (F2.7) y su ancho. Desde PP8 es una **columna angosta**
 * (34 rem): la página de enlaces se lee igual en el teléfono y en una pantalla grande, centrada
 * sobre el fondo, en vez de estirarse como un sitio web.
 */
export function Container({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    // Relleno por *container query* (PL5): la portada a sangre depende de él, y en la vista previa
    // del constructor el "teléfono" es un marco angosto dentro de una ventana ancha.
    <div className={`mx-auto w-full max-w-[34rem] px-4 @min-[40rem]:px-6 ${className}`} style={style}>
      {children}
    </div>
  );
}
