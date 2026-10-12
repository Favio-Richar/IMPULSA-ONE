"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "impulza-site-mode";

function lightness(hex: string): number {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Botón de modo día/noche (F10). Solo existe si el tema trae paleta alterna. Cambia las variables de color de la raíz del
 * sitio (el resto —tipografía, radio, bloques— no se toca), oculta la capa de fondo para que mande el color de la paleta
 * alterna y recuerda la elección en este navegador. Sin JavaScript la página se ve con la paleta principal, que es la
 * que ya cumple AA: el botón es una mejora, no un requisito.
 */
export function SiteModeToggle({ altVars, baseBackground }: { altVars: Record<string, string>; baseBackground: string }) {
  const [alt, setAlt] = useState(false);
  const base = useRef<Record<string, string> | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  function apply(root: HTMLElement, on: boolean): void {
    if (!base.current) {
      base.current = Object.fromEntries(Object.keys(altVars).map((name) => [name, root.style.getPropertyValue(name)]));
    }
    for (const [name, value] of Object.entries(altVars)) {
      if (on) root.style.setProperty(name, value);
      else {
        const original = base.current[name];
        if (original) root.style.setProperty(name, original);
        else root.style.removeProperty(name);
      }
    }
    if (on) root.setAttribute("data-site-mode", "alt");
    else root.removeAttribute("data-site-mode");
  }

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-site-root]");
    if (!root) return;
    rootRef.current = root;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored === "alt") {
      apply(root, true);
      setAlt(true);
    }
    // `altVars` es estable por tema: se aplica una sola vez al montar.
  }, []);

  function toggle(): void {
    const root = rootRef.current ?? document.querySelector<HTMLElement>("[data-site-root]");
    if (!root) return;
    const next = !alt;
    apply(root, next);
    setAlt(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "alt" : "base");
    } catch {
      // Sin almacenamiento (navegación privada): el cambio vale solo para esta visita.
    }
  }

  // El texto describe a dónde lleva el botón: «Modo claro» si la paleta a la que va es más clara.
  const baseIsLight = lightness(baseBackground) > 0.5;
  const altIsLight = lightness(altVars["--site-color-background"] ?? "#ffffff") > 0.5;
  const goingLight = alt ? baseIsLight : altIsLight;
  const label = goingLight ? "Cambiar a modo claro" : "Cambiar a modo oscuro";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={alt}
      aria-label={label}
      title={label}
      className="fixed right-4 top-4 z-50 flex size-11 items-center justify-center rounded-full border border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-[var(--site-color-foreground)] shadow-[var(--site-shadow)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))] motion-reduce:transition-none"
    >
      {goingLight ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
          <path d="M21 13a8 8 0 1 1-10-10 6.5 6.5 0 0 0 10 10Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
