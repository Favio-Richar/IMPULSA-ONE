"use client";

import { useEffect, useRef } from "react";

const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;

function readUtm(search: string): Record<string, string> | undefined {
  const params = new URLSearchParams(search);
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`);
    if (value) {
      // Mismo tope que valida la API (utmSchema): si se pasara, la API rechazaría el evento entero.
      utm[key] = value.slice(0, 120);
    }
  }
  return Object.keys(utm).length > 0 ? utm : undefined;
}

function send(endpoint: string, body: Record<string, unknown>): void {
  try {
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one" },
      body: JSON.stringify({ ...body, eventId: crypto.randomUUID() }),
      // Deja terminar el envío aunque la pestaña navegue afuera de inmediato (clic a un enlace).
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // La analítica nunca interfiere con la navegación del visitante: es una métrica, no una
    // condición para que la página funcione.
  }
}

/**
 * Rastreador único del sitio público (F3.6): `page_view` al cargar la página y un clic por cada
 * enlace dentro de un bloque (`block_click`, o `whatsapp_click` si el bloque es de WhatsApp). Por
 * delegación sobre `data-block-*` (ver `PageBlocks`): ningún bloque tiene que ser componente de
 * cliente ni saber de analítica, y nunca se llama a `preventDefault` — el enlace navega igual.
 *
 * Todo pasa por la ruta propia de apps/web (`/api/analytics/...`), nunca por apps/api directo.
 * Solo se monta en el sitio público: la vista previa del constructor no mide nada.
 */
export function AnalyticsTracker({ siteSlug, pageSlug }: { siteSlug: string; pageSlug: string }): null {
  // En desarrollo, StrictMode monta los efectos dos veces; la ref sobrevive a ese remontaje
  // simulado, así que la vista se cuenta una sola vez por página.
  const viewedPageRef = useRef<string | null>(null);

  useEffect(() => {
    const endpoint = `/api/analytics/${encodeURIComponent(siteSlug)}/events`;
    const utm = readUtm(window.location.search);

    if (viewedPageRef.current !== pageSlug) {
      viewedPageRef.current = pageSlug;
      send(endpoint, { type: "page_view", pageSlug, ...(utm ? { utm } : {}) });
    }

    function onClick(event: MouseEvent): void {
      // Clic principal o central (abrir en pestaña nueva también es un clic real).
      if (event.button !== 0 && event.button !== 1) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      const block = anchor?.closest<HTMLElement>("[data-block-position]");
      if (!block) {
        return;
      }
      const blockPosition = Number(block.dataset.blockPosition);
      if (!Number.isInteger(blockPosition)) {
        return;
      }
      send(endpoint, {
        type: block.dataset.blockType === "whatsapp" ? "whatsapp_click" : "block_click",
        pageSlug,
        blockPosition,
        ...(utm ? { utm } : {}),
      });
    }

    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("auxclick", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("auxclick", onClick, { capture: true });
    };
  }, [siteSlug, pageSlug]);

  return null;
}
