"use client";

import type { TemplateResponse } from "@impulza/contracts";
import { useIsClient } from "./use-is-client";
import { TemplateThumbnail } from "./template-thumbnail";

/**
 * Miniatura de plantilla que se pinta solo en el navegador. La miniatura es decorativa (`aria-hidden`), pero renderiza los
 * bloques reales de ejemplo —con su propio `h1` de perfil y textos «de ejemplo»—: en el HTML del servidor eso serían varios
 * títulos principales y relleno indexado en cada página de la galería. Mientras carga, un bloque del mismo alto (sin saltos).
 */
export function ClientTemplateThumbnail({ template, height, fitWidth = false }: { template: TemplateResponse; height: number; fitWidth?: boolean }) {
  const mounted = useIsClient();
  if (!mounted) return <div aria-hidden="true" className="animate-pulse bg-[#f1f5f9] motion-reduce:animate-none" style={{ height }} />;
  return <TemplateThumbnail template={template} height={height} fitWidth={fitWidth} />;
}
