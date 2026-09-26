"use client";

import { PageBlocks, SiteBackdrop } from "@impulza/blocks-renderer";
import type { TemplateResponse } from "@impulza/contracts";
import {
  backgroundForDisplay,
  parseStoredBlock,
  personalizeTemplateBlocks,
  resolveSiteBackground,
  themeTokensSchema,
  type TemplatePersonalization,
} from "@impulza/validation";
import { cn } from "@impulza/ui";

export type TemplatePreviewDevice = "mobile" | "desktop";

/** Ancho real de cada dispositivo: la vista previa se pinta a ese ancho, no a uno aproximado. */
export const PREVIEW_DEVICE_WIDTH: Record<TemplatePreviewDevice, number> = { mobile: 390, desktop: 1280 };

/**
 * La plantilla tal como se vería publicada (PL4): mismo `SiteBackdrop` + `PageBlocks` que el render
 * público y la vista previa del constructor, con el tema y el fondo de la plantilla y — en el
 * onboarding — la personalización del usuario aplicada con la **misma** función que usa el servidor
 * al guardar (`personalizeTemplateBlocks`). Un bloque que no pase su esquema se omite, igual que en
 * el sitio público.
 */
export function TemplatePreview({
  template,
  personalization,
  className,
  thumbnail = false,
}: {
  template: TemplateResponse;
  personalization?: TemplatePersonalization;
  className?: string;
  /** Miniatura de la galería: sin la barra fija del teléfono (ver `PageBlocks.primaryActionBar`). */
  thumbnail?: boolean;
}) {
  const tokens = themeTokensSchema.parse(template.theme.tokens);
  const background = resolveSiteBackground(backgroundForDisplay(template.background, template.theme.code), tokens, (key) => key);
  const blocks = personalizeTemplateBlocks(
    template.blocks.map((block) => ({ ...block })),
    personalization,
  ).flatMap((block, position) => {
    const parsed = parseStoredBlock(block.type, block.configSchemaVersion, block.config);
    return parsed.renderable ? [{ position, type: block.type, config: parsed.config, primary: block.isPrimary === true }] : [];
  });

  return (
    <SiteBackdrop theme={tokens} background={background} fixed={false} className={cn("min-h-full", className)}>
      <PageBlocks blocks={blocks} buttonStyle={tokens.buttonStyle} mode="preview" primaryActionBar={!thumbnail} />
    </SiteBackdrop>
  );
}

/**
 * Miniatura para la galería: la plantilla renderizada a ancho de teléfono real y reducida con
 * `transform`, sin interacción (`inert`) ni lectura por lector de pantalla — la tarjeta ya describe
 * la plantilla con texto.
 */
export function TemplateThumbnail({ template, scale = 0.55, height = 360 }: { template: TemplateResponse; scale?: number; height?: number }) {
  const width = PREVIEW_DEVICE_WIDTH.mobile;

  return (
    <div
      aria-hidden="true"
      inert
      className="relative mx-auto overflow-hidden rounded-md border border-border bg-surface"
      style={{ width: width * scale, height }}
    >
      <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width, transform: `scale(${scale})` }}>
        <TemplatePreview template={template} thumbnail />
      </div>
    </div>
  );
}
