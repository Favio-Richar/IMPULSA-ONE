"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const KEY = "impulza-template-favorites";
const listeners = new Set<() => void>();
let memory = "[]";

function readRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "[]";
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function parse(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 100) : [];
  } catch {
    return [];
  }
}

/** Plantillas favoritas de esta persona en este navegador (preferencia de comodidad: si no hay almacenamiento, solo vale en esta sesión). */
export function useTemplateFavorites(): { codes: string[]; toggle: (code: string) => void } {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const codes = useMemo(() => parse(raw), [raw]);
  const toggle = useCallback((code: string) => {
    const current = parse(readRaw());
    const next = JSON.stringify(current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
    memory = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // sin almacenamiento: queda en memoria
    }
    for (const listener of listeners) {
      listener();
    }
  }, []);
  return { codes, toggle };
}
