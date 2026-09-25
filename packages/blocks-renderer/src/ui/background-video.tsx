"use client";

import { useEffect, useState } from "react";

/**
 * Video de fondo (PP3). Primero, siempre, el póster como imagen fija: es lo que se ve al abrir y lo
 * que cuenta para el LCP. El video se agrega después, y solo si el visitante no pidió reducir el
 * movimiento ni ahorrar datos. `muted` + `playsInline` + `autoPlay` + `loop` es la única
 * combinación que los navegadores internos de Instagram y TikTok reproducen solos.
 */
export function BackgroundVideo({ posterUrl, src }: { posterUrl: string; src: string }) {
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const update = () => setPlay(!reducedMotion.matches && !saveData);
    update();
    reducedMotion.addEventListener("change", update);
    return () => reducedMotion.removeEventListener("change", update);
  }, []);

  return (
    <>
      {/* Decorativa: el fondo no aporta información (`alt=""`). */}
      <img src={posterUrl} alt="" loading="eager" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      {play ? (
        <video
          src={src}
          poster={posterUrl}
          muted
          playsInline
          autoPlay
          loop
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </>
  );
}
