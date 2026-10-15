"use client";

import type { ShowcaseBlockConfig } from "@impulza/validation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { SiteImage } from "../ui/site-image.js";

// Índice con portada (editor de portales, diseño `index` del bloque `showcase`). Adaptación del componente `music-portfolio` de
// 21st.dev al sistema:
//
// - **Contenido del negocio:** cada fila es una pieza de la vitrina (título, subtítulo, insignia, portada y enlace). Nada de los
//   datos del demo (cuentas, correos, coordenadas ni reloj de otra persona).
// - **Sin GSAP:** su licencia no permite usarlo en constructores visuales que compiten con Webflow (decisión de Favio,
//   2026-10-14). El efecto de «texto que se descifra» y la ola de la lista son propios (`requestAnimationFrame`).
// - **Legible siempre (AA):** cuando aparece una portada de fondo, la sección se cubre con un velo negro al 78 % y su texto pasa a
//   blanco (contraste ≥ 10:1 sobre cualquier foto). Sin portada activa, el texto es el de la página, sobre el fondo de la página.
// - **Accesible:** cada fila es un enlace con su nombre completo (`aria-label`); el efecto es solo visual. La portada aparece
//   también con el foco del teclado. Con «reducir movimiento» no hay efecto ni ola. En pantallas angostas, donde no hay «pasar
//   el mouse», cada fila muestra su portada en miniatura.

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*";
const SCRAMBLE_MS = 650;
/** Fracción del efecto en la que cada letra todavía puede ser aleatoria: después, las letras se revelan de izquierda a derecha. */
const REVEAL_DELAY = 0.25;

/** Texto que se descifra: escribe en el nodo directamente (sin estado de React) y vuelve al texto real al terminar o cancelar. */
function scramble(element: HTMLElement, text: string): () => void {
  const start = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / SCRAMBLE_MS);
    const revealed = Math.max(0, (progress - REVEAL_DELAY) / (1 - REVEAL_DELAY)) * text.length;
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const char = text[i]!;
      out += i < revealed || char === " " ? char : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
    }
    element.textContent = out;
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    element.textContent = text;
  };
}

export function ShowcaseIndex({ config }: { config: ShowcaseBlockConfig }) {
  const { items, title, actionLabel } = config;
  const [active, setActive] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const textRefs = useRef<Array<Array<HTMLSpanElement | null>>>([]);
  const cancelRef = useRef<Array<() => void>>([]);
  // El efecto escribe en el nodo de texto: cada <span> lleva su texto como `key`, así si el negocio lo cambia en el editor React
  // monta uno nuevo en vez de actualizar un nodo que el efecto ya reemplazó.
  const wavedRef = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Al entrar en pantalla, una sola ola de la lista (las filas se apagan y encienden en cascada): anuncia que es interactiva.
  // Una vez y corta (menos de 2 s), así no es contenido en movimiento continuo (WCAG 2.2.2).
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || reducedMotion || wavedRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry!.isIntersecting || wavedRef.current) return;
      wavedRef.current = true;
      observer.disconnect();
      rowRefs.current.forEach((row, index) => {
        row?.animate([{ opacity: 1 }, { opacity: 0.12 }, { opacity: 1 }], { duration: 520, delay: index * 70, easing: "ease-in-out" });
      });
    }, { threshold: 0.4 });
    observer.observe(section);
    return () => observer.disconnect();
  }, [reducedMotion]);

  const activate = useCallback(
    (index: number | null) => {
      setActive(index);
      cancelRef.current.forEach((cancel) => cancel());
      cancelRef.current = [];
      if (index === null || reducedMotion) return;
      const item = items[index]!;
      const texts = [item.title, item.subtitle ?? "", item.badge ?? ""];
      (textRefs.current[index] ?? []).forEach((element, slot) => {
        if (element && texts[slot]) cancelRef.current.push(scramble(element, texts[slot]));
      });
    },
    [items, reducedMotion],
  );

  useEffect(() => () => cancelRef.current.forEach((cancel) => cancel()), []);

  const current = active !== null ? items[active] : undefined;

  return (
    <section
      ref={sectionRef}
      aria-label={title ?? "Colecciones"}
      data-showcase-index=""
      data-active={current ? "" : undefined}
      onMouseLeave={() => activate(null)}
      className="relative isolate overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-color-border)]"
    >
      {/* Portada de fondo + velo: solo con una fila activa. Decorativa (la fila ya nombra la pieza). */}
      {items.map((item, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="absolute inset-0 -z-10 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none"
          style={{ opacity: active === index ? 1 : 0, transform: active === index ? "scale(1)" : "scale(1.12)" }}
        >
          <SiteImage image={{ ...item.image, decorative: true }} sizes="(min-width: 544px) 496px, 100vw" className="size-full object-cover" />
        </div>
      ))}
      <div aria-hidden="true" className={`absolute inset-0 -z-10 bg-black/[0.78] transition-opacity duration-500 motion-reduce:transition-none ${current ? "opacity-100" : "opacity-0"}`} />

      {title ? (
        <h2
          className={`px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.2em] transition-colors ${current ? "text-white/80" : "text-[var(--site-color-muted-foreground)]"}`}
        >
          {title}
        </h2>
      ) : null}
      <ul className="flex flex-col">
        {items.map((item, index) => {
          const isActive = active === index;
          // Con portada activa: blanco sobre el velo (la fila activa al 100 %, las demás al 72 %: ≥ 7:1 en el peor punto).
          const tone = current ? (isActive ? "text-white" : "text-white/[0.72]") : "text-[var(--site-color-foreground)]";
          const slot = (position: number) => (element: HTMLSpanElement | null) => {
            (textRefs.current[index] ??= [])[position] = element;
          };
          return (
            <li
              key={index}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
            >
              <a
                href={item.link}
                {...OUTBOUND_LINK}
                aria-label={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ""}${item.badge ? `, ${item.badge}` : ""}: ${actionLabel}`}
                onMouseEnter={() => activate(index)}
                onFocus={() => activate(index)}
                onBlur={() => activate(null)}
                className={`group grid grid-cols-[auto_1fr_auto] items-center gap-3 border-t border-[color-mix(in_srgb,currentColor_18%,transparent)] px-4 py-3.5 transition-colors duration-300 motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))] @min-[40rem]:grid-cols-[1fr_1.4fr_auto] ${tone}`}
              >
                {/* Teléfono: sin «pasar el mouse», la portada va en miniatura en la fila. */}
                <span aria-hidden="true" className="size-12 overflow-hidden rounded-[calc(var(--site-radius)*0.6)] bg-[var(--site-color-surface)] @min-[40rem]:hidden">
                  <SiteImage image={{ ...item.image, decorative: true }} sizes="48px" className="size-full object-cover" />
                </span>
                <span aria-hidden="true" className="flex min-w-0 flex-col gap-0.5 @min-[40rem]:contents">
                  <span key={`t-${item.title}`} ref={slot(0)} className="truncate text-base font-semibold uppercase tracking-wide" style={{ fontFamily: "var(--site-font-heading)" }}>
                    {item.title}
                  </span>
                  <span key={`s-${item.subtitle ?? ""}`} ref={slot(1)} className={`truncate text-sm ${current ? "" : "text-[var(--site-color-muted-foreground)]"} @min-[40rem]:uppercase @min-[40rem]:tracking-wide`}>
                    {item.subtitle ?? ""}
                  </span>
                </span>
                <span aria-hidden="true" className="flex items-center gap-2 justify-self-end font-mono text-xs uppercase tracking-wider">
                  <span key={`b-${item.badge ?? ""}`} ref={slot(2)}>
                    {item.badge ?? ""}
                  </span>
                  <svg viewBox="0 0 24 24" className="size-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">
                    <path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
