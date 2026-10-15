"use client";

import { useEffect } from "react";
import { captureTemplateIntent } from "../lib/template-intent";

/**
 * Guarda la plantilla que llega desde la galería pública (`?plantilla=<código>`) en cualquier página del panel donde caiga la
 * persona: el registro, el inicio de sesión o «Crear sitio» (aunque el panel la mande primero a iniciar sesión). No dibuja nada.
 */
export function TemplateIntentCapture(): null {
  useEffect(() => {
    captureTemplateIntent(window.location.search);
  }, []);
  return null;
}
