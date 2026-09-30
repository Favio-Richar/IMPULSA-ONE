"use client";

import { useState, type ReactNode } from "react";
import { ImageStreamHero } from "@/components/ui/image-stream-hero";
import { PHOTOS, unsplash } from "@/lib/marketing-images";

// Portada de la home: el corredor de fotos de negocios reales detrás del mensaje principal. El
// movimiento es continuo, así que lleva un control de pausa visible (WCAG 2.2.2); además se detiene
// solo si el sistema pide reducir el movimiento.
const STREAM = [
  PHOTOS.barberia,
  PHOTOS.cafeTazas,
  PHOTOS.tienda,
  PHOTOS.bienestar,
  PHOTOS.creadora,
  PHOTOS.panaderia,
  PHOTOS.fotografia,
  PHOTOS.concierto,
  PHOTOS.salud,
  PHOTOS.restaurante,
  PHOTOS.retrato,
  PHOTOS.caja,
].map((photo) => ({ src: unsplash(photo.id, 640), alt: photo.alt }));

export function CorridorHero({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return (
    <ImageStreamHero
      images={STREAM}
      // En un teléfono el texto ocupa más alto: el eje baja para que el corredor pase por debajo.
      axis="var(--corredor-eje)"
      paused={paused}
      className="h-[760px] w-full bg-white [--corredor-eje:80%] sm:h-[720px] sm:[--corredor-eje:68%]"
      data-testid="corridor-hero"
    >
      {/* Velo claro detrás del texto: contraste AA sobre cualquier foto que pase por debajo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_30%,rgba(255,255,255,0.96),rgba(255,255,255,0.82)_45%,rgba(255,255,255,0)_75%)]"
      />
      <div className="relative z-10 mx-auto flex h-full max-w-3xl flex-col items-center px-4 pt-14 text-center sm:pt-20">{children}</div>
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
        className="absolute bottom-4 right-4 z-10 rounded-full border border-[#e2e8f0] bg-white/90 px-3 py-1.5 text-xs font-medium text-[#0f172a] shadow-sm backdrop-blur transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {paused ? "Reanudar el movimiento" : "Pausar el movimiento"}
      </button>
    </ImageStreamHero>
  );
}
