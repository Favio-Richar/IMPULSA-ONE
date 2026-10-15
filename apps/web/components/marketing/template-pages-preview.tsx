"use client";

import { PageBlocks, SiteBackdrop } from "@impulza/blocks-renderer";
import type { TemplateResponse } from "@impulza/contracts";
import { backgroundForDisplay, parseStoredBlock, resolveSiteBackground, themeTokensSchema } from "@impulza/validation";
import { useId, useState } from "react";
import { useIsClient } from "./use-is-client";

const PREVIEW_WIDTH = 390;

type SeedBlock = TemplateResponse["blocks"][number];

function renderable(blocks: SeedBlock[]) {
  return blocks.flatMap((block, position) => {
    const parsed = parseStoredBlock(block.type, block.configSchemaVersion, block.config);
    return parsed.renderable ? [{ position, type: block.type, config: parsed.config, primary: block.isPrimary === true }] : [];
  });
}

/**
 * Las páginas de una plantilla, a tamaño real de teléfono, con el mismo motor que un sitio publicado: una pestaña por página
 * (inicio y compañeras). La pantalla se desplaza por dentro para ver la página entera; su contenido es una muestra, no se
 * puede usar (`inert`), así que el teclado no se pierde dentro de botones de ejemplo.
 */
export function TemplatePagesPreview({ template, pageLabels }: { template: TemplateResponse; pageLabels: Record<string, string> }) {
  const id = useId();
  const pages = [{ slug: "inicio", blocks: template.blocks }, ...(template.companionPages ?? [])];
  const [active, setActive] = useState(0);
  // Solo en el navegador: el HTML del servidor (lo que leen los buscadores) no lleva el contenido de ejemplo de la plantilla
  // (su propio `h1` de perfil, textos «de ejemplo»), así la página tiene un único título principal y no indexa relleno.
  const mounted = useIsClient();
  const tokens = themeTokensSchema.parse(template.theme.tokens);
  const background = resolveSiteBackground(backgroundForDisplay(template.background, template.theme.code), tokens, (key) => key);
  const current = pages[active]!;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (active + delta + pages.length) % pages.length;
    setActive(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div role="tablist" aria-label="Páginas de la plantilla" onKeyDown={onKeyDown} className="flex flex-wrap justify-center gap-1 rounded-full border border-[#e2e8f0] bg-white p-1">
        {pages.map((page, index) => (
          <button
            key={page.slug}
            id={`${id}-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls={`${id}-panel`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            className={`min-h-10 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f6f6b] ${
              index === active ? "bg-[#0f172a] text-white" : "text-[#334155] hover:bg-[#f1f5f9]"
            }`}
          >
            {pageLabels[page.slug] ?? page.slug}
          </button>
        ))}
      </div>
      <div className="w-full max-w-[24.5rem] rounded-[2.6rem] bg-[#10272a] p-2 shadow-[0_22px_40px_-22px_rgba(15,23,42,0.6)] ring-1 ring-black/20">
        <div className="overflow-hidden rounded-[2.1rem] bg-white">
          <div
            id={`${id}-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${active}`}
            tabIndex={0}
            className="h-[44rem] overflow-y-auto overscroll-contain bg-white [scrollbar-color:#cbd5e1_transparent] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#0f6f6b]"
          >
            {mounted ? (
              <div inert className="pointer-events-none" style={{ width: "100%", maxWidth: PREVIEW_WIDTH, margin: "0 auto" }}>
                <SiteBackdrop key={current.slug} theme={tokens} background={background} fixed={false} showModeToggle={false} className="min-h-[44rem]">
                  <PageBlocks blocks={renderable(current.blocks)} buttonStyle={tokens.buttonStyle} mode="preview" primaryActionBar={false} />
                </SiteBackdrop>
              </div>
            ) : (
              <div aria-hidden="true" className="h-full animate-pulse bg-[#f1f5f9] motion-reduce:animate-none" />
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-[#64748b]">Contenido de ejemplo: lo reemplazas con lo tuyo después de elegirla.</p>
    </div>
  );
}
