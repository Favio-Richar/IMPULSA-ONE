"use client";

import { useRef } from "react";
import type { TemplateResponse } from "@impulza/contracts";
import { TemplateMockup } from "./shared";

// Carrusel horizontal de plantillas reales del catálogo (scroll-snap nativo + botones), para el
// showcase de la home. Nunca usa contenido inventado: cada tarjeta es una plantilla real que ya
// existe en /api/v1/templates.
export function TemplateCarousel({
  templates,
  bienvenidaHref,
}: {
  templates: TemplateResponse[];
  bienvenidaHref: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  function scrollByCards(direction: 1 | -1) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>("[data-carousel-card]");
    const step = card ? card.getBoundingClientRect().width + 24 : 300;
    track.scrollBy({ left: step * direction, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <div
        ref={trackRef}
        className="[scrollbar-width:none] flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth pb-2 [&::-webkit-scrollbar]:hidden"
      >
        {templates.map((template) => (
          <a
            key={template.code}
            href={bienvenidaHref}
            data-carousel-card
            className="block w-[260px] shrink-0 snap-start sm:w-[280px]"
          >
            <TemplateMockup template={template} />
          </a>
        ))}
      </div>

      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => scrollByCards(-1)}
          aria-label="Plantilla anterior"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e2e8f0] bg-white text-lg text-[#0f172a] shadow-sm transition-colors hover:bg-[#f8fafc] focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => scrollByCards(1)}
          aria-label="Siguiente plantilla"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[#e2e8f0] bg-white text-lg text-[#0f172a] shadow-sm transition-colors hover:bg-[#f8fafc] focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ›
        </button>
      </div>
    </div>
  );
}
