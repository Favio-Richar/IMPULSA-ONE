"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "impulza-panel-nav-collapsed";
const CHANGE_EVENT = "impulza:nav-collapsed";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readSnapshot(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): el menú queda expandido.
    return false;
  }
}

/**
 * Preferencia (solo de este navegador) de tener el menú lateral plegado a íconos. El servidor y la primera
 * hidratación usan «expandido», así el HTML coincide y no hay salto; después se aplica lo guardado.
 */
export function useNavCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribe, readSnapshot, () => false);
  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(KEY, readSnapshot() ? "0" : "1");
    } catch {
      // La preferencia simplemente no se recuerda.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [collapsed, toggle];
}
