"use client";

import { PageBlocks, SiteBackdrop } from "@impulza/blocks-renderer";
import type { TemplateResponse } from "@impulza/contracts";
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
export function TemplateThumbnail({ template, height = 280 }: { template: TemplateResponse; height?: number }) {
  const scale = height / (PREVIEW_WIDTH * 1.6);
  const tokens = themeTokensSchema.parse(template.theme.tokens);
  const background = resolveSiteBackground(backgroundForDisplay(template.background, template.theme.code), tokens, (key) => key);
  const blocks = template.blocks.flatMap((block, position) => {
    const parsed = parseStoredBlock(block.type, block.configSchemaVersion, block.config);
    return parsed.renderable ? [{ position, type: block.type, config: parsed.config, primary: block.isPrimary === true }] : [];
  });

  return (
    <div aria-hidden="true" inert className="relative overflow-hidden" style={{ height }}>
      <div
        className="pointer-events-none absolute top-0"
        style={{ left: "50%", width: PREVIEW_WIDTH, transform: `translateX(-50%) scale(${scale})`, transformOrigin: "top" }}
      >
        <SiteBackdrop theme={tokens} background={background} fixed={false} className="min-h-full">
          <PageBlocks blocks={blocks} buttonStyle={tokens.buttonStyle} mode="preview" primaryActionBar={false} />
        </SiteBackdrop>
      </div>
    </div>
  );
}
