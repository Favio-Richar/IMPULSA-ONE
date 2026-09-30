"use client";

// Portada editorial a sangre, guiada por una tira de tarjetas.
//
// Todas las tarjetas comparten el borde superior. La enfocada se despliega a alto completo y sus
// vecinas quedan recortadas a la mitad; cambiar el foco re-tiñe todo el fondo con esa imagen.
//
// Las medidas nunca están fijas: un ResizeObserver lee el escenario y todo es proporción de él.
//
// Integración en Impulza One (sitio comercial): textos de accesibilidad en español, botones
// Anterior/Siguiente (en un teléfono no hay teclado), la rueda del mouse solo si se pide (`wheel`)
// para no atrapar el scroll de la página, y los saltos de línea del título como "\n".
import * as React from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";

export interface HeroCarouselItem {
  /** Clave estable; si falta, el índice. */
  id?: string | number;
  /** Título de la diapositiva activa. Cada "\n" es una línea que entra por separado. */
  title: string;
  /** URL de la imagen: tarjeta y fondo teñido. */
  image: string;
  /** Texto de la imagen para lectores de pantalla (la tarjeta la nombra el título). */
  imageAlt?: string;
  /** Línea junto al título, p. ej. "PLANTILLA BARBERÍA". */
  credit?: string;
  /** Datos a la derecha, p. ej. ["RESERVAS", "WHATSAPP"]. */
  meta?: string[];
  /** Color con que se tiñe el fondo: la foto conserva su luminancia y toma este tono. @default "#8a8a8a" */
  accent?: string;
}

export interface HeroCarouselProps {
  items: HeroCarouselItem[];
  /** Diapositiva enfocada, si se controla desde afuera. */
  index?: number;
  /** Diapositiva inicial sin control externo. @default 0 */
  defaultIndex?: number;
  onIndexChange?: (index: number) => void;
  /** Marca en la barra superior. */
  brand?: React.ReactNode;
  /** Nombre del carrusel para lectores de pantalla. @default "Destacados" */
  label?: string;
  /** Avanza solo. Se pausa con el puntero encima, al arrastrar y con el foco. @default false */
  autoplay?: boolean;
  /** Milisegundos entre pasos automáticos. @default 4000 */
  autoplayDelay?: number;
  /** La rueda del mouse mueve la tira. Apagado por defecto: en medio de una página atraparía el scroll. @default false */
  wheel?: boolean;
  /** Contenido extra al pie (p. ej. un llamado a la acción). */
  children?: React.ReactNode;
  className?: string;
}

const CARD_H = 0.264; // alto de la tarjeta activa ÷ alto del escenario
const CARD_AR = 0.75; // tarjeta activa 3:4
const GAP = 0.038; // separación ÷ ancho de tarjeta
const STRIP_TOP = 0.5; // borde superior común de la tira
const TITLE = 0.067; // tamaño del título ÷ alto
const LABEL = 0.0103; // etiqueta pequeña ÷ alto
const PAD = 0.017; // margen ÷ ancho
const RAIL = 0.2; // riel de progreso ÷ ancho

const WHEEL_THRESHOLD = 60;
const WHEEL_COOLDOWN = 420;

/* Grano fotográfico como SVG autocontenido: el componente no trae archivos. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function HeroCarousel({
  items,
  index: controlled,
  defaultIndex = 0,
  onIndexChange,
  brand,
  label = "Destacados",
  autoplay = false,
  autoplayDelay = 4000,
  wheel = false,
  children,
  className,
}: HeroCarouselProps) {
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const [uncontrolled, setUncontrolled] = React.useState(defaultIndex);
  const [dragging, setDragging] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const reduced = useReducedMotion();

  const last = items.length - 1;
  const index = clamp(controlled ?? uncontrolled, 0, Math.max(0, last));

  const go = React.useCallback(
    (next: number) => {
      const clamped = clamp(next, 0, Math.max(0, last));
      if (controlled === undefined) setUncontrolled(clamped);
      if (clamped !== index) onIndexChange?.(clamped);
    },
    [controlled, index, last, onIndexChange],
  );

  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const read = () => setBox({ w: stage.clientWidth, h: stage.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  const fullH = clamp(box.h * CARD_H, 96, 360);
  const halfH = fullH / 2;
  const cardW = fullH * CARD_AR;
  const gap = Math.max(4, Math.round(cardW * GAP));
  const step = cardW + gap;
  const pad = Math.max(16, Math.round(box.w * PAD));
  const labelSize = Math.max(11, Math.round(box.h * LABEL));

  const xFor = React.useCallback((i: number) => box.w / 2 - (i * step + cardW / 2), [box.w, step, cardW]);
  const x = useMotionValue(0);
  const target = xFor(index);

  const swing = reduced ? { duration: 0 } : { duration: 0.7, ease: "easeOut" as const };
  const spring = reduced ? { duration: 0 } : { type: "spring" as const, stiffness: 260, damping: 34, mass: 0.9 };

  // La tira se mueve con un valor de movimiento: un arrastre que empieza a mitad de un resorte lee
  // la posición real, no a dónde iba.
  React.useEffect(() => {
    if (dragging) return;
    const run = animate(x, target, spring);
    return () => run.stop();
  }, [target, dragging, reduced, x]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !wheel) return;
    let acc = 0;
    let until = 0;
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      // En un extremo, el gesto vuelve a la página: nunca una trampa de scroll.
      const stuck = (delta > 0 && index === last) || (delta < 0 && index === 0);
      if (stuck) {
        acc = 0;
        return;
      }
      e.preventDefault();
      const now = e.timeStamp;
      if (now < until) return;
      acc += delta;
      if (Math.abs(acc) < WHEEL_THRESHOLD) return;
      go(index + Math.sign(acc));
      acc = 0;
      until = now + WHEEL_COOLDOWN;
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [go, index, last, wheel]);

  React.useEffect(() => {
    if (!autoplay || paused || dragging || items.length < 2 || reduced) return;
    const id = window.setTimeout(() => go(index === last ? 0 : index + 1), autoplayDelay);
    return () => window.clearTimeout(id);
  }, [autoplay, autoplayDelay, dragging, go, index, items.length, last, paused, reduced]);

  const active = items[index];
  if (!active) return null;

  const lines = active.title.split("\n");
  const accent = active.accent ?? "#8a8a8a";
  const navButton =
    "flex h-11 w-11 items-center justify-center rounded-full border border-white/40 bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40";

  return (
    <div
      ref={stageRef}
      tabIndex={0}
      role="group"
      aria-roledescription="carrusel"
      aria-label={label}
      onKeyDown={(e) => {
        const keys: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: last };
        if (!(e.key in keys)) return;
        e.preventDefault();
        go(keys[e.key]!);
      }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        "relative h-full min-h-[34rem] w-full select-none overflow-hidden bg-black text-white",
        "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60",
        className,
      )}
    >
      {/* Fondo: la foto enfocada, ampliada y teñida con su color. */}
      <AnimatePresence initial={false}>
        <motion.div key={index} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={swing}>
          <motion.img
            src={active.image}
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ scale: reduced ? 1.28 : 1.42 }}
            animate={{ scale: 1.28 }}
            transition={reduced ? { duration: 0 } : { duration: 6, ease: "linear" }}
          />
          <div className="absolute inset-0" style={{ backgroundColor: accent, mixBlendMode: "color" }} />
          <div className="absolute inset-0 opacity-55" style={{ backgroundColor: accent, mixBlendMode: "multiply" }} />
        </motion.div>
      </AnimatePresence>

      {/* Velo de legibilidad y grano, sobre el cambio para que nunca parpadeen. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/60" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.22] mix-blend-overlay" style={{ backgroundImage: GRAIN, backgroundSize: "180px 180px" }} />

      {brand ? (
        <div className="absolute inset-x-0 flex justify-center" style={{ top: Math.max(16, box.h * 0.035) }}>
          <div className="font-mono uppercase tracking-[0.2em] opacity-90" style={{ fontSize: labelSize * 1.2 }}>
            {brand}
          </div>
        </div>
      ) : null}

      {/* Título, justo sobre el borde de la tira. */}
      <div
        className="absolute inset-x-0 top-0 flex flex-col justify-end"
        style={{ height: `${STRIP_TOP * 100}%`, paddingLeft: pad, paddingRight: pad, paddingBottom: Math.round(box.h * 0.028) }}
      >
        <div className="flex w-full flex-wrap items-end gap-x-[6vw] gap-y-2">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h2
              key={index}
              // Las líneas son bloques sin espacio entre sí: sin esto, un lector de pantalla leería
              // "Cafés yrestaurantes".
              aria-label={lines.join(" ")}
              className="font-semibold leading-[0.9] tracking-[-0.03em]"
              style={{ fontSize: Math.max(30, Math.round(box.h * TITLE)) }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.18 } }}
            >
              {lines.map((line, i) => (
                <span key={i} className="block overflow-hidden pb-[0.06em]">
                  <motion.span
                    className="block"
                    initial={{ y: "110%" }}
                    animate={{ y: 0 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.62, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </motion.h2>
          </AnimatePresence>

          {active.credit ? (
            <motion.p
              key={`credit-${index}`}
              className="font-mono uppercase tracking-[0.14em]"
              style={{ fontSize: labelSize }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.9 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              {active.credit}
            </motion.p>
          ) : null}

          {active.meta?.length ? (
            <ul className="ml-auto flex flex-wrap items-end" style={{ gap: `${Math.max(14, box.w * 0.045)}px` }}>
              {active.meta.map((fact, i) => (
                <motion.li
                  key={`${index}-${fact}`}
                  className="whitespace-nowrap font-mono uppercase tracking-[0.14em]"
                  style={{ fontSize: labelSize }}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 0.9, y: 0 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.45, delay: 0.12 + i * 0.06 }}
                >
                  {fact}
                </motion.li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {/* La tira: borde superior común, la enfocada al doble de alto. */}
      <div className="absolute inset-x-0" style={{ top: `${STRIP_TOP * 100}%`, height: fullH }}>
        <motion.div
          className="flex items-start"
          style={{ gap, x, cursor: dragging ? "grabbing" : "grab" }}
          drag="x"
          dragMomentum={false}
          dragElastic={0.08}
          dragConstraints={{ left: xFor(last), right: xFor(0) }}
          onDragStart={() => setDragging(true)}
          onDragEnd={(_, info) => {
            setDragging(false);
            const thrown = x.get() + info.velocity.x * 0.12;
            go(Math.round((box.w / 2 - thrown - cardW / 2) / step));
          }}
        >
          {items.map((item, i) => (
            <motion.button
              key={item.id ?? i}
              type="button"
              aria-label={item.title.replace(/\n/g, " ")}
              aria-current={i === index}
              onClick={() => go(i)}
              className="relative shrink-0 overflow-hidden bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ width: cardW }}
              animate={{ height: i === index ? fullH : halfH }}
              transition={spring}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- recortes animados por altura; next/image no aporta. */}
              <img src={item.image} alt={item.imageAlt ?? ""} draggable={false} className="h-full w-full object-cover" style={{ objectPosition: "50% 30%" }} />
              <motion.span aria-hidden className="absolute inset-0 bg-black" animate={{ opacity: i === index ? 0 : 0.18 }} transition={spring} />
            </motion.button>
          ))}
        </motion.div>
      </div>

      {/* Pie: posición y controles. */}
      <div className="absolute inset-x-0 flex flex-wrap items-end justify-between gap-4" style={{ left: pad, right: pad, bottom: Math.max(16, box.h * 0.03) }}>
        <div style={{ width: Math.max(140, box.w * RAIL) }}>
          <div className="flex justify-between font-mono tabular-nums" style={{ fontSize: labelSize }} aria-live="polite">
            <span>
              <span className="sr-only">Diapositiva </span>
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>
              <span className="sr-only">de </span>
              {String(items.length).padStart(2, "0")}
            </span>
          </div>
          <div className="relative mt-2 h-px w-full bg-white/30">
            <motion.div className="absolute inset-y-0 bg-white" style={{ width: `${100 / items.length}%` }} animate={{ left: `${(index / items.length) * 100}%` }} transition={spring} />
          </div>
        </div>
        {children}
        <div className="flex gap-2">
          <button type="button" className={navButton} onClick={() => go(index - 1)} disabled={index === 0} aria-label="Anterior">
            <span aria-hidden>←</span>
          </button>
          <button type="button" className={navButton} onClick={() => go(index + 1)} disabled={index === last} aria-label="Siguiente">
            <span aria-hidden>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default HeroCarousel;
