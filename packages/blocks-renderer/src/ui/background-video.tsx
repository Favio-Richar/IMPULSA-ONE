"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Video de fondo (PP3). Primero, siempre, el póster como imagen fija: es lo que se ve al abrir y lo
 * que cuenta para el LCP. El video se agrega después, y solo si el visitante no pidió reducir el
 * movimiento ni ahorrar datos. `muted` + `playsInline` + `autoPlay` + `loop` es la única
 * combinación que los navegadores internos de Instagram y TikTok reproducen solos.
 *
 * PL5 (WCAG 2.2.2, "Pausar, detener, ocultar"): mientras el video se mueve hay un botón para
 * pausarlo y volver a reproducirlo. Va **fuera** de la capa del fondo (que es decorativa y está
 * oculta a los lectores de pantalla), montado en la raíz del sitio; sin video en movimiento no hay
 * botón. `fixed`: en el sitio público queda en la esquina de la pantalla; en la vista previa del
 * constructor, en la del marco.
 */
export function BackgroundVideo({ posterUrl, src, fixed = true }: { posterUrl: string; src: string; fixed?: boolean }) {
  const [play, setPlay] = useState(false);
  // Estado **real** del video (sus eventos), no supuesto: en un teléfono el video puede tardar en
  // arrancar, y un botón que dijera "Pausar" mientras está detenido haría lo contrario de lo que dice.
  const [paused, setPaused] = useState(true);
  const [root, setRoot] = useState<Element | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const update = () => setPlay(!reducedMotion.matches && !saveData);
    update();
    reducedMotion.addEventListener("change", update);
    return () => reducedMotion.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setRoot(anchorRef.current?.closest("[data-site-root]") ?? null);
  }, []);

  function toggle(): void {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }

  return (
    <>
      <span ref={anchorRef} hidden />
      {/* Decorativa: el fondo no aporta información (`alt=""`). */}
      <img src={posterUrl} alt="" loading="eager" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      {play ? (
        <video
          ref={videoRef}
          src={src}
          poster={posterUrl}
          muted
          playsInline
          autoPlay
          loop
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          onPlaying={() => setPaused(false)}
          onPause={() => setPaused(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {play && root
        ? createPortal(
            <button
              type="button"
              data-background-video-toggle=""
              onClick={toggle}
              aria-label={paused ? "Reproducir el video de fondo" : "Pausar el video de fondo"}
              // Blanco sobre negro al 60 %: el ícono y el borde se distinguen sobre cualquier foto.
              className={`${fixed ? "fixed" : "absolute"} right-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/40 bg-black/60 text-white shadow-[var(--site-shadow)] backdrop-blur-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2`}
            >
              {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
            </button>,
            root,
          )
        : null}
    </>
  );
}
