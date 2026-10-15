"use client";

import type { GalleryBlockConfig } from "@impulza/validation";
import { Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteImage } from "../ui/site-image.js";

// Esfera de imágenes (editor de portales, diseño `sphere` del bloque `gallery`). Adaptación del componente `img-sphere` de
// 21st.dev al sistema, con los mismos criterios que la rueda de trabajos:
//
// - **Rendimiento:** un único `requestAnimationFrame` escribe posición, escala, opacidad y orden directo en el DOM; React no se
//   vuelve a renderizar en cada cuadro (el original guardaba la rotación en el estado y redibujaba todo 60 veces por segundo).
//   La animación se detiene fuera de pantalla.
// - **Determinista:** la distribución de Fibonacci lleva una variación fija por índice (no `Math.random`), así el servidor y el
//   navegador dibujan lo mismo y la esfera no cambia de forma en cada visita.
// - **Accesible (WCAG 2.2 AA):** cada foto es un botón con su texto alternativo que abre un visor (`<dialog>` nativo: atrapa el
//   foco y cierra con Escape); las flechas del teclado giran la esfera; el giro automático se puede pausar (2.2.2) y con
//   «reducir movimiento» no gira solo ni conserva inercia. Sin JavaScript se ve la cuadrícula de siempre.
// - **Tema del sitio:** borde, superficie y foco salen de los tokens `--site-*`, no de colores fijos del demo.

/** Nodos mínimos para que la esfera se lea como esfera: con pocas fotos, se repiten (las copias no se anuncian ni se enfocan). */
const MIN_NODES = 18;
/** Lado máximo de la escena, en px. */
const MAX_SIZE = 520;
const RADIUS_RATIO = 0.34;
const NODE_RATIO = 0.24;
const DRAG_SENSITIVITY = 0.45;
const MOMENTUM_DECAY = 0.94;
const MAX_SPEED = 6;
const AUTO_SPEED = 0.18;
const KEY_STEP = 12;

const rad = (deg: number) => (deg * Math.PI) / 180;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Variación fija en [-0.5, 0.5) a partir del índice (sin estado, igual en servidor y navegador). */
function jitter(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

interface SphereNode {
  theta: number;
  phi: number;
  /** Índice de la foto en la configuración. */
  image: number;
  /** `false` en las repeticiones de relleno. */
  original: boolean;
}

function sphereNodes(count: number): SphereNode[] {
  const total = Math.max(count, MIN_NODES);
  const golden = (1 + Math.sqrt(5)) / 2;
  return Array.from({ length: total }, (_, i) => {
    const inclination = Math.acos(1 - (2 * (i + 0.5)) / total);
    // Polos cubiertos sin los extremos (15° a 165°), con una variación fija para que no se vea como una grilla perfecta.
    const phi = clamp(15 + (inclination / Math.PI) * 150 + jitter(i, 1) * 8, 8, 172);
    const theta = (((360 / golden) * i + jitter(i, 2) * 18) % 360 + 360) % 360;
    return { theta, phi, image: i % count, original: i < count };
  });
}

export function GallerySphere({ config }: { config: GalleryBlockConfig }) {
  const { images } = config;
  const nodes = useMemo(() => sphereNodes(images.length), [images.length]);
  const stageRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLElement | null)[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const rotation = useRef({ x: 12, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number; moved: number } | null>(null);
  const visible = useRef(true);
  /** Tras arrastrar, el clic que cierra el gesto no abre la foto. */
  const suppressClick = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [size, setSize] = useState(MAX_SIZE);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const autoRotate = playing && !reducedMotion;

  useEffect(() => {
    setMounted(true);
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Tamaño de la escena: el ancho disponible, sin pasar de `MAX_SIZE`.
  useEffect(() => {
    const stage = stageRef.current?.parentElement;
    if (!mounted || !stage) return;
    const observer = new ResizeObserver(([entry]) => setSize(Math.round(Math.min(MAX_SIZE, entry!.contentRect.width))));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [mounted]);

  // Fuera de pantalla no se anima nada.
  useEffect(() => {
    const stage = stageRef.current;
    if (!mounted || !stage) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry!.isIntersecting;
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [mounted]);

  /** Escribe en el DOM la posición de cada nodo para la rotación actual. */
  const paint = useCallback(() => {
    const radius = size * RADIUS_RATIO;
    const rx = rad(rotation.current.x);
    const ry = rad(rotation.current.y);
    nodes.forEach((node, index) => {
      const element = nodeRefs.current[index];
      if (!element) return;
      const t = rad(node.theta);
      const p = rad(node.phi);
      let x = radius * Math.sin(p) * Math.cos(t);
      let y = radius * Math.cos(p);
      let z = radius * Math.sin(p) * Math.sin(t);
      const x1 = x * Math.cos(ry) + z * Math.sin(ry);
      const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
      x = x1;
      z = z1;
      const y2 = y * Math.cos(rx) - z * Math.sin(rx);
      const z2 = y * Math.sin(rx) + z * Math.cos(rx);
      y = y2;
      z = z2;
      // Frente: nítido y grande; atrás: se desvanece hasta desaparecer (y deja de ser clicable).
      const depth = (z + radius) / (2 * radius);
      const centerDistance = Math.min(Math.hypot(x, y) / radius, 1);
      // Más grande al frente y al centro, sin achicarse tanto en los bordes: la esfera se lee como un volumen lleno de fotos.
      const scale = Math.max(0.45, 1 - centerDistance * 0.35) * (0.62 + depth * 0.42);
      const opacity = z > -radius * 0.1 ? 1 : clamp((z + radius * 0.45) / (radius * 0.35), 0, 1);
      element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
      element.style.opacity = String(opacity);
      element.style.zIndex = String(Math.round(1000 + z));
      element.style.pointerEvents = opacity > 0.4 ? "auto" : "none";
      element.style.visibility = opacity <= 0.02 ? "hidden" : "visible";
    });
  }, [nodes, size]);

  // Bucle único de animación: giro automático + inercia.
  useEffect(() => {
    if (!mounted) return;
    let frame = 0;
    const tick = () => {
      if (visible.current && !dragging.current) {
        const v = velocity.current;
        if (reducedMotion) {
          v.x = 0;
          v.y = 0;
        } else {
          v.x *= MOMENTUM_DECAY;
          v.y *= MOMENTUM_DECAY;
          if (Math.abs(v.x) < 0.01) v.x = 0;
          if (Math.abs(v.y) < 0.01) v.y = 0;
        }
        rotation.current.x = clamp(rotation.current.x + v.x, -60, 60);
        rotation.current.y = (rotation.current.y + v.y + (autoRotate ? AUTO_SPEED : 0)) % 360;
      }
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mounted, autoRotate, reducedMotion, paint]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    dragging.current = { x: event.clientX, y: event.clientY, moved: 0 };
    velocity.current = { x: 0, y: 0 };
  }

  useEffect(() => {
    if (!mounted) return;
    const move = (event: PointerEvent) => {
      const drag = dragging.current;
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = event.clientX;
      drag.y = event.clientY;
      const delta = { x: clamp(-dy * DRAG_SENSITIVITY, -MAX_SPEED, MAX_SPEED), y: clamp(dx * DRAG_SENSITIVITY, -MAX_SPEED, MAX_SPEED) };
      rotation.current.x = clamp(rotation.current.x + delta.x, -60, 60);
      rotation.current.y = (rotation.current.y + delta.y) % 360;
      velocity.current = delta;
    };
    const up = () => {
      // Un arrastre no debe abrir la foto que estaba bajo el dedo: se marca y el clic lo ignora.
      const drag = dragging.current;
      dragging.current = null;
      if (drag && drag.moved > 6) suppressClick.current = true;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [mounted]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const steps: Record<string, [number, number]> = { ArrowLeft: [0, -KEY_STEP], ArrowRight: [0, KEY_STEP], ArrowUp: [KEY_STEP, 0], ArrowDown: [-KEY_STEP, 0] };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    rotation.current.x = clamp(rotation.current.x + step[0], -60, 60);
    rotation.current.y = (rotation.current.y + step[1]) % 360;
    paint();
  }

  function openImage(index: number): void {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setOpen(index);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open !== null && !dialog.open) dialog.showModal();
    if (open === null && dialog.open) dialog.close();
  }, [open]);

  // Sin JavaScript (y en el primer render del servidor) se ve la cuadrícula: el contenido nunca depende de la animación.
  if (!mounted) {
    return (
      <div className="grid grid-cols-3 gap-2" data-gallery-sphere="fallback">
        {images.map((image, index) => (
          <SiteImage key={index} image={image} sizes="160px" className="aspect-square w-full rounded-full border border-[var(--site-color-border)] object-cover" />
        ))}
      </div>
    );
  }

  const nodeSize = Math.round(size * NODE_RATIO);
  const current = open !== null ? images[open] : undefined;

  return (
    <div className="flex flex-col items-center gap-3" data-gallery-sphere="">
      <div
        ref={stageRef}
        role="group"
        aria-roledescription="esfera de fotos"
        aria-label={`Galería en esfera, ${images.length} ${images.length === 1 ? "foto" : "fotos"}. Arrastra o usa las flechas para girarla.`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="relative cursor-grab touch-pan-y select-none rounded-full outline-offset-4 active:cursor-grabbing"
        style={{ width: size, height: size }}
      >
        {nodes.map((node, index) => {
          const image = images[node.image]!;
          const style = { width: nodeSize, height: nodeSize, left: "50%", top: "50%" } as const;
          const face = (
            <SiteImage
              image={{ ...image, decorative: true }}
              sizes={`${nodeSize * 2}px`}
              draggable={false}
              className="size-full rounded-full border-2 border-[var(--site-color-border)] bg-[var(--site-color-surface)] object-cover shadow-[var(--site-shadow)]"
            />
          );
          return node.original ? (
            <button
              key={index}
              ref={(element) => {
                nodeRefs.current[index] = element;
              }}
              type="button"
              aria-label={`Ver en grande: ${image.alt || `foto ${node.image + 1}`}`}
              onClick={() => openImage(node.image)}
              className="absolute rounded-full transition-[filter] duration-200 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))]"
              style={style}
            >
              {face}
            </button>
          ) : (
            <span
              key={index}
              ref={(element) => {
                nodeRefs.current[index] = element;
              }}
              aria-hidden="true"
              className="pointer-events-none absolute"
              style={style}
            >
              {face}
            </span>
          );
        })}
      </div>

      {reducedMotion ? null : (
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-pressed={!playing}
          className="inline-flex min-h-11 items-center gap-2 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] px-4 text-sm font-medium text-[var(--site-theme-foreground,var(--site-color-foreground))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))]"
        >
          {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
          {playing ? "Pausar giro" : "Girar sola"}
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-label={current?.alt || "Foto"}
        onClose={() => setOpen(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(null);
        }}
        className="m-auto w-[min(92vw,36rem)] overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-0 text-[var(--site-theme-foreground,var(--site-color-foreground))] backdrop:bg-black/70"
      >
        {current ? (
          <figure className="relative m-0">
            <SiteImage image={current} sizes="(min-width: 640px) 576px, 92vw" className="max-h-[75vh] w-full object-contain" />
            {current.alt && !current.decorative ? <figcaption className="px-4 py-3 text-sm">{current.alt}</figcaption> : null}
            <button
              type="button"
              autoFocus
              onClick={() => setOpen(null)}
              aria-label="Cerrar"
              className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full bg-black/70 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </figure>
        ) : null}
      </dialog>
    </div>
  );
}
