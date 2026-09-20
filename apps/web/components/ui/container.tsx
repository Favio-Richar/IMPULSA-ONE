import type { CSSProperties, ReactNode } from "react";

/** Ancho de lectura cómodo y el relleno horizontal fijo de toda la página (F2.7). */
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
    <div className={`mx-auto w-full max-w-3xl px-4 sm:px-6 ${className}`} style={style}>
      {children}
    </div>
  );
}
