"use client";

import { PageBlocks, SiteBackdrop } from "@impulza/blocks-renderer";
import type { TemplateResponse } from "@impulza/contracts";
import { useEffect, useRef, useState } from "react";
import {
  backgroundForDisplay,
  parseStoredBlock,
  resolveSiteBackground,
  themeTokensSchema,
} from "@impulza/validation";

/** Ancho real del teléfono al que se pinta la miniatura (mismo criterio que el panel interno). */
const PREVIEW_WIDTH = 390;

/**
 * Miniatura REAL de una plantilla: renderiza sus bloques de ejemplo con el mismo motor que un
 * sitio ya publicado (`@impulza/blocks-renderer`), a escala reducida y recortada -- nunca una
 * tarjeta abstracta con barras de color. Mismo patrón que `TemplateThumbnail` de apps/dashboard
 * (galería del onboarding), adaptado para no depender de `@impulza/ui` (apps/web no la usa) ni de
 * personalización (acá no hay organización todavía).
 */
export function TemplateThumbnail({
  template,
  height = 280,
  fitWidth = false,
}: {
  template: TemplateResponse;
  height?: number;
  /** Escala al ancho real del contenedor (el teléfono llena el marco) en vez de derivarla del alto. */
  fitWidth?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);
  useEffect(() => {
    if (!fitWidth || !hostRef.current) return;
    const el = hostRef.current;
    const measure = () => setHostWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitWidth]);
  const baseScale = fitWidth ? (hostWidth > 0 ? hostWidth / PREVIEW_WIDTH : 0.0001) : height / (PREVIEW_WIDTH * 1.6);
  // Con `fitWidth`, una plantilla corta (sin portada) no llena el alto del marco a `baseScale` y deja un
  // espacio en blanco abajo -- se mide el alto real del contenido (`scrollHeight` no lo afecta `scale`, que es
  // puramente visual) y se sube el zoom lo necesario para que el marco quede siempre lleno, igual que una
  // plantilla con foto de portada (nunca se reduce el zoom: solo sube cuando hace falta).
  useEffect(() => {
    if (!fitWidth || !contentRef.current) return;
    const el = contentRef.current;
    const measure = () => setNaturalHeight(el.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitWidth]);
  const scale = fitWidth && naturalHeight > 0 ? Math.max(baseScale, height / naturalHeight) : baseScale;
  const tokens = themeTokensSchema.parse(template.theme.tokens);
  const background = resolveSiteBackground(backgroundForDisplay(template.background, template.theme.code), tokens, (key) => key);
  const blocks = template.blocks.flatMap((block, position) => {
    const parsed = parseStoredBlock(block.type, block.configSchemaVersion, block.config);
    return parsed.renderable ? [{ position, type: block.type, config: parsed.config, primary: block.isPrimary === true }] : [];
  });

  return (
    <div ref={hostRef} aria-hidden="true" inert className="relative overflow-hidden" style={{ height }}>
      <div
        ref={contentRef}
        className="pointer-events-none absolute top-0"
        style={{ left: "50%", width: PREVIEW_WIDTH, transform: `translateX(-50%) scale(${scale})`, transformOrigin: "top" }}
      >
        <SiteBackdrop theme={tokens} background={background} fixed={false} showModeToggle={false} className="min-h-full">
          <PageBlocks blocks={blocks} buttonStyle={tokens.buttonStyle} mode="preview" primaryActionBar={false} zeroEngagementPreview />
        </SiteBackdrop>
      </div>
    </div>
  );
}
