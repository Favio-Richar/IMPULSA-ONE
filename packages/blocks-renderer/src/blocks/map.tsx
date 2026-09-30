"use client";

import { MapPin, Navigation } from "lucide-react";
import type { MapBlockConfig } from "@impulza/validation";
import { useState } from "react";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { stackSurfaceClass } from "../ui/stack-button.js";

/** Enlaces "Cómo llegar" y el `src` del mapa: plantillas fijas, la dirección siempre codificada. */
export function mapLinks(address: string) {
  const query = encodeURIComponent(address);
  return {
    googleDirections: `https://www.google.com/maps/dir/?api=1&destination=${query}`,
    waze: `https://waze.com/ul?q=${query}&navigate=yes`,
    embed: `https://www.google.com/maps?q=${query}&output=embed`,
  };
}

const ACTION =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[calc(var(--site-radius)/1.5)] border border-[var(--site-color-border)] px-4 py-2 text-sm font-medium text-[var(--site-color-foreground)] transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Mapa (F7.3, ADR-018 §2): una tarjeta propia con la dirección y "Cómo llegar". El mapa de Google
 * se carga **solo** si el visitante presiona "Ver mapa": abrir la página no comparte nada con Google
 * y no carga un iframe pesado de entrada.
 */
export function MapBlock({ config, glass = false }: { config: MapBlockConfig; glass?: boolean }) {
  const [showMap, setShowMap] = useState(false);
  const links = mapLinks(config.address);
  const label = config.name ?? config.address;

  return (
    <section className={`flex flex-col gap-4 p-5 ${stackSurfaceClass(glass ? "glass" : "secondary")}`} aria-label={`Ubicación: ${label}`} data-map="">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]">
          <MapPin className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          {config.name ? <h2 className="font-semibold text-[var(--site-color-foreground)]">{config.name}</h2> : null}
          <address className="text-sm not-italic text-[var(--site-color-foreground)]">{config.address}</address>
          {config.note ? <p className="text-sm text-[var(--site-color-muted-foreground)]">{config.note}</p> : null}
        </div>
      </div>

      {showMap ? (
        <div className="aspect-[4/3] overflow-hidden rounded-[calc(var(--site-radius)/1.5)] border border-[var(--site-color-border)]">
          <iframe
            src={links.embed}
            title={`Mapa de ${label}`}
            className="h-full w-full"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <a href={links.googleDirections} {...OUTBOUND_LINK} className={ACTION}>
          <Navigation className="h-4 w-4" aria-hidden="true" />
          Cómo llegar
        </a>
        <a href={links.waze} {...OUTBOUND_LINK} className={ACTION}>
          Waze
        </a>
        {config.showMap && !showMap ? (
          <button type="button" onClick={() => setShowMap(true)} className={`${ACTION} col-span-2`} data-map-load="">
            <MapPin className="h-4 w-4" aria-hidden="true" />
            Ver mapa
          </button>
        ) : null}
      </div>
      {config.showMap && !showMap ? <p className="-mt-2 text-center text-xs text-[var(--site-color-muted-foreground)]">El mapa se carga desde Google Maps.</p> : null}
    </section>
  );
}
