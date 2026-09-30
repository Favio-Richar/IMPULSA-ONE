"use client";

import { useSyncExternalStore } from "react";

// Reloj para los bloques con fecha (F7.3, ADR-018). En el servidor (y en la primera pasada del
// navegador, al hidratar) vale `null`: el bloque pinta lo que no depende del momento (la fecha
// escrita), así el HTML del servidor y el del navegador coinciden y la página cacheada nunca queda
// con un "faltan 3 días" viejo. Después de hidratar, avanza cada `intervalMs`.

const stores = new Map<number, { subscribe: (onChange: () => void) => () => void; snapshot: () => number }>();

function storeFor(intervalMs: number) {
  let store = stores.get(intervalMs);
  if (!store) {
    store = {
      subscribe: (onChange) => {
        const timer = window.setInterval(onChange, intervalMs);
        return () => window.clearInterval(timer);
      },
      // Redondeado al intervalo: el mismo valor entre dos lecturas seguidas (requisito de React).
      snapshot: () => Math.floor(Date.now() / intervalMs) * intervalMs,
    };
    stores.set(intervalMs, store);
  }
  return store;
}

const serverSnapshot = () => null;

/** Milisegundos actuales (redondeados al intervalo), o `null` en el servidor y al hidratar. */
export function useNow(intervalMs: number): number | null {
  const store = storeFor(intervalMs);
  return useSyncExternalStore(store.subscribe, store.snapshot, serverSnapshot);
}
