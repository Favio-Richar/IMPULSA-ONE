"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* ── El corredor ─────────────────────────────────────────────────
 * Dos rieles de tarjetas viajan desde muy atrás de la pantalla hacia quien mira. La perspectiva
 * sola hace lo que parecen dos animaciones: al crecer la z de una tarjeta, se agranda *y* su x en
 * pantalla se abre desde el punto de fuga, porque la proyección escala posición y tamaño por igual.
 *
 * 1. La profundidad se define como *tamaño aparente*, geométrico: cada tarjeta es una proporción
 *    constante más grande que la de atrás. Espaciar la z de forma pareja rompe la cinta cerca.
 * 2. Los rieles se abren fuerte al principio y luego se mantienen (`fan` > 1): la cinta sale del
 *    centro plana, se dobla una vez y recién ahí corre en diagonal.
 * 3. Ningún extremo del ciclo se ve: la tarjeta muere con su borde interior fuera del contenedor, y
 *    nace *cruzada* sobre el eje (`railBirth` negativo), así el centro nunca queda vacío.
 *
 * Toda medida está en `cqw` (porcentaje del ancho del contenedor): conserva la forma a cualquier
 * tamaño. Integrado en Impulza One (sitio comercial) con un control de pausa (WCAG 2.2.2).
 * ─────────────────────────────────────────────────────────────── */

/** Geometría del corredor. Toda longitud en `cqw`. */
export type CorridorPath = {
  /** Fuerza de la proyección. Menor = gran angular más dramático. @default 30 */
  perspective?: number;
  /** Ancho de tarjeta en unidades de mundo. @default 18 */
  cardWidth?: number;
  /** Alto de tarjeta en unidades de mundo. @default 25 */
  cardHeight?: number;
  /** Radio de las esquinas. @default 0.4 */
  cardRadius?: number;
  /** Alto en pantalla al nacer (cintura). @default 2.6 */
  birthHeight?: number;
  /** Alto en pantalla al salir del cuadro. @default 46 */
  exitHeight?: number;
  /** Desplazamiento lateral al nacer; negativo = nace cruzada (ver nota 3). @default -11 */
  railBirth?: number;
  /** Desplazamiento lateral con los rieles abiertos. @default 44 */
  railExit?: number;
  /** Cuán adelantada es la apertura. >1 abre temprano y se mantiene. @default 3.3 */
  fan?: number;
  /** Rotación Y al nacer, grados. @default 6 */
  turnBirth?: number;
  /** Rotación Y al salir, grados. @default 28 */
  turnExit?: number;
  /** Paradas para trazar la curva. @default 24 */
  stops?: number;
};

const PATH: Required<CorridorPath> = {
  perspective: 30,
  cardWidth: 18,
  cardHeight: 25,
  cardRadius: 0.4,
  birthHeight: 2.6,
  exitHeight: 46,
  railBirth: -11,
  railExit: 44,
  fan: 3.3,
  turnBirth: 6,
  turnExit: 28,
  stops: 24,
};

/** Muestrea la trayectoria una vez para que los keyframes CSS sigan la curva real. */
function keyframes(dir: 1 | -1, name: string, p: Required<CorridorPath>) {
  const steps: string[] = [];
  for (let s = 0; s <= p.stops; s++) {
    const u = s / p.stops;
    const scale = (p.birthHeight / p.cardHeight) * Math.pow(p.exitHeight / p.birthHeight, u);
    const z = p.perspective * (1 - 1 / scale);
    const rail = p.railExit - (p.railExit - p.railBirth) * Math.pow(1 - u, p.fan);
    const turn = p.turnBirth + (p.turnExit - p.turnBirth) * u;
    steps.push(
      `${(u * 100).toFixed(2)}%{transform:translate3d(${(dir * rail).toFixed(2)}cqw,0,${z.toFixed(2)}cqw) rotateY(${(-dir * turn).toFixed(2)}deg)}`,
    );
  }
  return `@keyframes ${name}{${steps.join("")}}`;
}

export type StreamImage = {
  src: string;
  /** Solo si se quita el tratamiento decorativo: el corredor es `aria-hidden`. */
  alt?: string;
};

export type ImageStreamHeroProps = {
  /** Imágenes que recorren los rieles (ambos con la misma secuencia, en espejo). */
  images: StreamImage[];
  /** Tarjetas por riel. Más = corredor más denso, no más rápido. @default 9 */
  cards?: number;
  /** Segundos que tarda una tarjeta en recorrer el corredor. @default 18 */
  speed?: number;
  /**
   * Altura del eje: número = porcentaje del alto; texto = cualquier largo CSS (p. ej.
   * `"var(--eje)"`, para cambiarlo por tamaño de pantalla sin JavaScript). @default 55
   */
  axis?: number | string;
  /** Detiene el movimiento (control de pausa visible, WCAG 2.2.2). @default false */
  paused?: boolean;
  /** Ajustes de geometría, sobre los valores por defecto. */
  path?: CorridorPath;
  /** Contenido por encima del corredor. */
  children?: React.ReactNode;
  className?: string;
};

export function ImageStreamHero({
  images,
  cards = 9,
  speed = 18,
  axis = 55,
  paused = false,
  path,
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & ImageStreamHeroProps) {
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const right = `ish-r-${id}`;
  const left = `ish-l-${id}`;
  const card = `ish-c-${id}`;

  const p = React.useMemo(() => ({ ...PATH, ...path }), [path]);
  const axisLength = typeof axis === "number" ? `${axis}%` : axis;

  const css = React.useMemo(
    () =>
      `${keyframes(1, right, p)}${keyframes(-1, left, p)}` +
      // `!important`: el `animation` en línea de cada tarjeta reinicia `animation-play-state` y le
      // ganaría a esta regla (así venía el componente original: con movimiento reducido seguía moviéndose).
      // Pausar en vez de desactivar mantiene el corredor completo: cada tarjeta ya está a mitad de
      // camino por su retraso negativo, así que queda como una imagen fija terminada.
      `@media(prefers-reduced-motion:reduce){.${card}{animation-play-state:paused!important}}`,
    [right, left, card, p],
  );

  return (
    <div className={cn("relative overflow-hidden", className)} {...props} style={{ containerType: "inline-size", ...props.style }}>
      <style>{css}</style>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ perspective: `${p.perspective}cqw`, perspectiveOrigin: `50% ${axisLength}` }}
      >
        <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
          {[right, left].map((name) =>
            Array.from({ length: cards }, (_, i) => {
              const img = images[i % Math.max(images.length, 1)];
              return (
                <div
                  key={`${name}-${i}`}
                  className={cn(card, "absolute overflow-hidden")}
                  style={{
                    left: "50%",
                    top: axisLength,
                    width: `${p.cardWidth}cqw`,
                    height: `${p.cardHeight}cqw`,
                    marginLeft: `${-p.cardWidth / 2}cqw`,
                    marginTop: `${-p.cardHeight / 2}cqw`,
                    borderRadius: `${p.cardRadius}cqw`,
                    animation: `${name} ${speed}s linear infinite`,
                    animationDelay: `${-(i * speed) / cards}s`,
                    animationPlayState: paused ? "paused" : undefined,
                    backfaceVisibility: "hidden",
                  }}
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element -- decorativas en 3D con CSS; next/image no aporta acá y rompe el transform.
                    <img src={img.src} alt={img.alt ?? ""} loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />
                  ) : null}
                </div>
              );
            }),
          )}
        </div>
      </div>

      {children}
    </div>
  );
}

export default ImageStreamHero;
