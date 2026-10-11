"use client";

import type { WorksWheelBlockConfig } from "@impulza/validation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { SiteImage } from "../ui/site-image.js";

// Rueda de trabajos (F10, bloque `works_wheel`). Un portafolio que se hace girar: en reposo, las piezas
// forman un anillo alrededor del título; el primer giro lo abre en un tambor vertical donde la pieza del
// frente se ve plana y las vecinas se alejan en perspectiva. Todo se mueve con un solo número (`turn`) que
// un único `requestAnimationFrame` escribe directo en el DOM, así girar la rueda no re-renderiza React.
//
// Adaptación al sistema: colores, radio y sombra salen de los tokens del tema del sitio (`--site-*`), no
// de clases del demo; el contenido (piezas, imágenes, enlaces y textos) lo administra el negocio desde el
// constructor; en pantallas angostas el gesto es el deslizamiento horizontal (no quita el scroll vertical de
// la página) y hay botones y un título visibles fuera de la escena 3D.

const CARD_H = 0.34; // alto de la tarjeta del frente, respecto de la escena
const CARD_MAX_W = 0.42; // ... sin pasar de esta fracción del ancho
const CARD_RATIO = 1.45; // ancho / alto de la tarjeta
const STEP = 40; // grados entre tarjetas en el tambor
const DRUM = 2.22; // radio del tambor, en alturas de tarjeta
const LENS = 2.7; // distancia de la perspectiva
const RING_R = 1.14; // radio del anillo
const BOW = 1.82; // curvatura lateral del tambor
const CULL = 1.6; // piezas a cada lado del frente que todavía se dibujan

const WHEEL_UNITS = 900;
const DRAG_UNITS = 360;
const DRAG_THRESHOLD = 6;
const SETTLE = 140;
const EASE = 0.12;
/** Escena ancha: ahí cabe el índice lateral; en teléfono solo estorbaría. */
const WIDE_STAGE = 640;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rad = (deg: number) => (deg * Math.PI) / 180;
const bowAt = (drumDeg: number, bow: number) => -bow * (1 - Math.cos(rad(drumDeg)));

/** Ambos estados en una cadena: los términos del anillo se apagan al llegar al tambor y viceversa. */
function place(ringDeg: number, drumDeg: number, ringR: number, drumR: number, bow: number, m: number): string {
  return (
    `translateX(${m * bowAt(drumDeg, bow)}px)` +
    ` rotateZ(${(1 - m) * ringDeg}deg) translateY(${-(1 - m) * ringR}px)` +
    ` rotateX(${m * drumDeg}deg) translateZ(${m * drumR}px)`
  );
}

/**
 * `mode="public"`: la rueda se sale de la columna de la página para verse completa. En la vista previa del
 * constructor (un marco más angosto que la pantalla) se queda dentro de su marco.
 */
export function WorksWheelBlock({ config, mode = "public" }: { config: WorksWheelBlockConfig; mode?: "public" | "preview" }) {
  const { items, label, actionLabel } = config;
  const stageRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const labelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const settling = useRef(0);
  const drag = useRef<{ start: number; last: number; moved: boolean; captured: boolean } | null>(null);
  const suppressClick = useRef(false);

  const turn = useRef(0);
  const target = useRef(0);
  const [active, setActive] = useState(0);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);
  // `true` cuando la rueda ya se abrió en tambor (el anillo en reposo muestra solo el título central).
  const [opened, setOpened] = useState(false);

  const count = items.length;
  const last = Math.max(count - 1, 0);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const metrics = useMemo(() => {
    const { w, h } = stage;
    const cardW = Math.min(h * CARD_H * CARD_RATIO, w * CARD_MAX_W);
    const cardH = cardW / CARD_RATIO;
    const drumR = cardH * DRUM;
    const ringR = cardH * RING_R;
    const ringScale = count ? clamp((((2 * Math.PI * ringR) / count) * 0.82) / (cardW || 1), 0.16, 1) : 1;
    return {
      cardW,
      cardH,
      ringR,
      ringScale,
      drumR,
      bow: cardH * BOW,
      depth: cardH * LENS,
      // Texto legible aunque la escena sea chica: nunca por debajo de 16 px / 13 px.
      title: Math.max(16, cardH * 0.124),
      index: Math.max(13, cardH * 0.06),
    };
  }, [stage, count]);

  // Una pasada por cuadro: acercarse al objetivo y escribir cada transformación.
  useEffect(() => {
    if (!stage.h) return;
    let frame = 0;
    const { ringR, ringScale, drumR, bow } = metrics;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const gap = target.current - turn.current;
      if (Math.abs(gap) < 0.0005) turn.current = target.current;
      else turn.current += gap * (reduced ? 1 : EASE);

      const t = turn.current;
      const m = clamp(t, 0, 1);
      const pos = Math.max(0, t - 1);

      if (wheelRef.current) wheelRef.current.style.transform = `translateZ(${-m * drumR}px)`;

      for (let i = 0; i < count; i++) {
        const d = i - pos;
        const card = cardRefs.current[i];
        if (card) {
          card.style.transform = place(d * (360 / count), d * STEP, ringR, drumR, bow, m);
          card.style.opacity = m > 0.5 && Math.abs(d) > CULL ? "0" : "1";
          // Las piezas que no están al frente no reciben toques (la de adelante tapa a las demás).
          card.style.pointerEvents = m > 0.5 && Math.abs(d) > 0.5 ? "none" : "auto";
          card.style.zIndex = String(Math.round(100 - Math.abs(d) * 2));
        }
        const face = card?.firstElementChild as HTMLElement | null;
        if (face) face.style.transform = `scale(${lerp(ringScale, 1, m)})`;
      }

      if (labelRef.current) labelRef.current.style.opacity = String(1 - m);
      if (titleRef.current) titleRef.current.style.opacity = String(m);
      const near = clamp(Math.round(pos), 0, last);
      setActive((previous) => (previous === near ? previous : near));
      const isOpen = m > 0.5;
      setOpened((previous) => (previous === isOpen ? previous : isOpen));
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [metrics, stage.h, count, last, reduced]);

  const to = useCallback(
    (next: number) => {
      target.current = clamp(next, 0, last + 1);
    },
    [last],
  );

  // Rueda del mouse: solo se atrapa mientras la rueda tiene adónde ir, así la página sigue en los extremos.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const next = target.current + event.deltaY / WHEEL_UNITS;
      if (next > 0 && next < last + 1) event.preventDefault();
      to(next);
      window.clearTimeout(settling.current);
      settling.current = window.setTimeout(() => to(Math.round(target.current)), SETTLE);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(settling.current);
    };
  }, [to, last]);

  const wide = stage.w >= WIDE_STAGE;
  const shownIndex = Math.min(active, last);
  const atRing = !opened;
  const current = items[shownIndex];

  // La rueda necesita espacio: en pantallas anchas se sale de la columna de la página (hasta 56 rem) para que el tambor se vea completo.
  return (
    <section
      aria-label={label}
      className={`flex flex-col gap-3 text-[var(--site-color-foreground)] ${mode === "public" ? "relative left-1/2 w-[min(calc(100vw-2rem),56rem)] -translate-x-1/2" : "w-full"}`}
    >
      <div
        ref={stageRef}
        tabIndex={0}
        role="listbox"
        aria-label={`${label}: usa las flechas arriba y abajo para girar`}
        aria-activedescendant={`works-wheel-${shownIndex}`}
        className="relative h-[clamp(24rem,92vw,34rem)] w-full cursor-grab select-none overflow-hidden rounded-[var(--site-radius)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-color-primary)] active:cursor-grabbing"
        // `pan-y`: el scroll vertical de la página sigue funcionando en el teléfono; el giro es un deslizamiento horizontal.
        style={{ perspective: `${metrics.depth}px`, touchAction: "pan-y" }}
        onPointerDown={(event) => {
          const touch = event.pointerType === "touch";
          const point = touch ? event.clientX : event.clientY;
          drag.current = { start: point, last: point, moved: false, captured: false };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state) return;
          const touch = event.pointerType === "touch";
          const point = touch ? event.clientX : event.clientY;
          if (!state.moved && Math.abs(point - state.start) < DRAG_THRESHOLD) return;
          state.moved = true;
          // El mouse captura el puntero solo al arrastrar de verdad: así un clic simple llega al enlace de la pieza.
          if (!state.captured && !touch) {
            event.currentTarget.setPointerCapture(event.pointerId);
            state.captured = true;
          }
          to(target.current + (state.last - point) / DRAG_UNITS);
          state.last = point;
        }}
        onPointerUp={() => {
          const state = drag.current;
          drag.current = null;
          if (state?.moved) {
            suppressClick.current = true;
            window.setTimeout(() => {
              suppressClick.current = false;
            }, 0);
            if (target.current > 1) to(Math.round(target.current));
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onClickCapture={(event) => {
          // Un arrastre no es un clic: no abre el enlace de la pieza sobre la que terminó el gesto.
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowRight") to(Math.round(target.current) + 1);
          else if (event.key === "ArrowUp" || event.key === "ArrowLeft") to(Math.round(target.current) - 1);
          else return;
          event.preventDefault();
        }}
      >
        <div ref={wheelRef} className="absolute left-1/2 top-1/2 [transform-style:preserve-3d]">
          {items.map((item, index) => {
            const style = {
              width: metrics.cardW,
              height: metrics.cardH,
              marginLeft: -metrics.cardW / 2,
              marginTop: -metrics.cardH / 2,
            };
            const face = (
              <span className="relative block size-full overflow-hidden rounded-[var(--site-radius)] bg-[var(--site-color-surface)] shadow-[var(--site-shadow)]">
                <SiteImage
                  image={{ url: item.image.url, alt: item.image.alt || item.title, decorative: item.image.decorative }}
                  sizes="240px"
                  draggable={false}
                  className="size-full object-cover"
                />
              </span>
            );
            const common = {
              id: `works-wheel-${index}`,
              role: "option" as const,
              "aria-selected": index === shownIndex,
              className: "absolute [backface-visibility:hidden]",
              style,
            };
            return item.link ? (
              <a
                key={index}
                {...common}
                href={item.link}
                {...OUTBOUND_LINK}
                aria-label={`${item.title}: ${actionLabel}`}
                ref={(node) => {
                  cardRefs.current[index] = node;
                }}
              >
                {face}
              </a>
            ) : (
              <div
                key={index}
                {...common}
                aria-label={item.title}
                ref={(node) => {
                  cardRefs.current[index] = node;
                }}
              >
                {face}
              </div>
            );
          })}
        </div>

        <div
          ref={labelRef}
          className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center font-semibold tracking-tight"
          style={{ fontSize: metrics.title }}
        >
          {label}
        </div>
        {wide ? (
          <>
            <div
              ref={titleRef}
              className="pointer-events-none absolute left-[6%] top-1/2 max-w-[28%] -translate-y-1/2 font-semibold tracking-tight opacity-0"
              style={{ fontSize: metrics.title }}
            >
              {current?.title}
            </div>
            <ol className="absolute right-[2.5%] top-[7.5%] text-right leading-[1.75] text-[var(--site-color-muted-foreground)]" style={{ fontSize: metrics.index }}>
              {items.map((item, index) => (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => to(index + 1)}
                    className={`cursor-pointer outline-none transition-colors focus-visible:underline ${index === shownIndex ? "font-semibold text-[var(--site-color-foreground)]" : ""}`}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          // Teléfono: el título activo va debajo de la escena (en la escena chocaría con la tarjeta).
          <div ref={titleRef} className="hidden" />
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => to(Math.round(target.current) - 1)}
          disabled={atRing}
          aria-label="Pieza anterior"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-lg disabled:opacity-40"
        >
          ↑
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-medium" aria-live="polite">
          {atRing ? `${count} piezas` : `${shownIndex + 1} / ${count} · ${current?.title ?? ""}`}
        </p>
        <button
          type="button"
          onClick={() => to(Math.round(target.current) + 1)}
          aria-label="Pieza siguiente"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-lg"
        >
          ↓
        </button>
      </div>
    </section>
  );
}
