"use client";

import type { AlbumBlockConfig } from "@impulza/validation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SiteImage } from "../ui/site-image.js";
import { WideBleed } from "../ui/wide-bleed.js";

// Álbum profesional (F10): filtros por categoría, mosaico o cuadrícula, carga de a 12 y un visor a pantalla completa
// (teclado, deslizamiento, contador, foco atrapado y devuelto). El visor se monta en `document.body` para no depender de
// los ancestros con `transform` (las animaciones por scroll los crean y romperían `position: fixed`).

const PAGE_SIZE = 12;
const SWIPE_PX = 50;

type Photo = AlbumBlockConfig["photos"][number];

function Lightbox({ photos, index, onIndex, onClose }: { photos: Photo[]; index: number; onIndex: (next: number) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const swipe = useRef<number | null>(null);
  const total = photos.length;
  const photo = photos[index]!;
  const go = useCallback((delta: number) => onIndex((index + delta + total) % total), [index, total, onIndex]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "Tab") {
        // Foco atrapado entre los tres controles del visor.
        const order = [closeRef.current, prevRef.current, nextRef.current].filter((node): node is HTMLButtonElement => node !== null);
        const position = order.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey ? (position <= 0 ? order.length - 1 : position - 1) : position === order.length - 1 ? 0 : position + 1;
        event.preventDefault();
        order[next]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // Precarga de las vecinas: pasar de foto no deja un hueco.
  useEffect(() => {
    for (const offset of [-1, 1]) {
      const neighbour = photos[(index + offset + total) % total];
      if (neighbour) new Image().src = neighbour.image.url;
    }
  }, [index, photos, total]);

  const control =
    "flex size-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Foto ${index + 1} de ${total}${photo.title ? `: ${photo.title}` : ""}`}
      className="fixed inset-0 z-[1000] flex flex-col bg-black/95 text-white"
      onPointerDown={(event) => {
        swipe.current = event.clientX;
      }}
      onPointerUp={(event) => {
        if (swipe.current === null) return;
        const delta = event.clientX - swipe.current;
        swipe.current = null;
        if (Math.abs(delta) > SWIPE_PX) go(delta < 0 ? 1 : -1);
      }}
    >
      <div className="flex items-center justify-between gap-3 p-3">
        <p className="text-sm tabular-nums text-white/80" aria-live="polite">
          {index + 1} / {total}
        </p>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar visor" className={control}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
        <button ref={prevRef} type="button" onClick={() => go(-1)} aria-label="Foto anterior" className={`${control} absolute left-2 z-10 sm:left-4`}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <img
          key={photo.image.url}
          src={photo.image.url}
          alt={photo.image.decorative ? "" : photo.image.alt || photo.title || ""}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
        />
        <button ref={nextRef} type="button" onClick={() => go(1)} aria-label="Foto siguiente" className={`${control} absolute right-2 z-10 sm:right-4`}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="min-h-16 p-4 text-center">
        {photo.title ? <p className="text-base font-medium">{photo.title}</p> : null}
        {photo.category ? <p className="text-sm text-white/70">{photo.category}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

export function AlbumBlock({ config, mode = "public" }: { config: AlbumBlockConfig; mode?: "public" | "preview" }) {
  const [category, setCategory] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [open, setOpen] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const photo of config.photos) {
      if (photo.category && !seen.includes(photo.category)) seen.push(photo.category);
    }
    return seen;
  }, [config.photos]);

  const filtered = useMemo(() => (category ? config.photos.filter((photo) => photo.category === category) : config.photos), [config.photos, category]);
  const shown = filtered.slice(0, visible);
  const masonry = config.layout === "masonry";

  const close = useCallback(() => {
    setOpen(null);
    // Devuelve el foco a la foto desde la que se abrió el visor.
    opener.current?.focus();
  }, []);

  return (
    <WideBleed mode={mode} size="xl">
      <section aria-label={config.title ?? "Álbum"} className="flex flex-col gap-5">
        {config.title || config.description ? (
          <div className="flex flex-col gap-2 text-center">
            {config.title ? (
              <h2 className="text-2xl font-semibold text-[var(--site-color-foreground)]" style={{ fontFamily: "var(--site-font-heading)" }}>
                {config.title}
              </h2>
            ) : null}
            {config.description ? <p className="mx-auto max-w-prose text-sm text-[var(--site-color-muted-foreground)]">{config.description}</p> : null}
          </div>
        ) : null}

        {config.showFilters && categories.length > 1 ? (
          <div role="group" aria-label="Filtrar fotos por categoría" className="flex flex-wrap justify-center gap-2">
            {[null, ...categories].map((entry) => {
              const active = entry === category;
              return (
                <button
                  key={entry ?? "todas"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setCategory(entry);
                    setVisible(PAGE_SIZE);
                  }}
                  className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))] motion-reduce:transition-none ${
                    active
                      ? "border-transparent bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]"
                      : "border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-[var(--site-color-foreground)]"
                  }`}
                >
                  {entry ?? "Todas"}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Con pocas fotos, menos columnas: así el mosaico no queda con huecos a la derecha. */}
        <ul
          className={masonry ? "columns-2 gap-3 sm:[column-count:var(--album-columns)]" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"}
          style={{ "--album-columns": Math.min(4, Math.max(2, Math.ceil(shown.length / 3))) } as React.CSSProperties}
        >
          {shown.map((photo, index) => (
            <li key={`${photo.image.url}-${index}`} className={masonry ? "mb-3 break-inside-avoid" : ""}>
              <button
                type="button"
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setOpen(index);
                }}
                aria-label={photo.title ? `Ver foto: ${photo.title}` : `Ver foto ${index + 1}`}
                className="group relative block w-full overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] shadow-[var(--site-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))]"
              >
                <SiteImage
                  image={{ url: photo.image.url, alt: photo.image.alt || photo.title || "", decorative: photo.image.decorative }}
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  className={`w-full transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${masonry ? "h-auto" : "aspect-square object-cover"}`}
                />
                {photo.title ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 text-left text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
                    {photo.title}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        {filtered.length > visible ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setVisible((current) => current + PAGE_SIZE)}
              className="inline-flex min-h-11 items-center rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] px-6 text-sm font-semibold text-[var(--site-color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))]"
            >
              Ver más fotos ({filtered.length - visible})
            </button>
          </div>
        ) : null}
      </section>
      {open !== null && typeof document !== "undefined" ? <Lightbox photos={filtered} index={open} onIndex={setOpen} onClose={close} /> : null}
    </WideBleed>
  );
}
