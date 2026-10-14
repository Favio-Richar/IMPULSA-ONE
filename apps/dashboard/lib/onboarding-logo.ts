"use client";

import { useSyncExternalStore } from "react";

/**
 * Logo o foto elegido en el paso 1 del asistente. Vive solo en memoria: todavía no hay organización a la que subirlo (se
 * crea al publicar), y un archivo no cabe en el borrador de `sessionStorage`. Se sube al publicar; si la persona recarga
 * la pestaña antes, simplemente lo vuelve a elegir.
 */
interface LogoState {
  file: File | null;
  previewUrl: string | null;
}

let state: LogoState = { file: null, previewUrl: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setOnboardingLogo(file: File | null): void {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
  }
  state = file ? { file, previewUrl: URL.createObjectURL(file) } : { file: null, previewUrl: null };
  emit();
}

export function getOnboardingLogoFile(): File | null {
  return state.file;
}

export function useOnboardingLogo(): LogoState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}
