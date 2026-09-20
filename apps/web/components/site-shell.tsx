import type { CSSProperties, ReactNode } from "react";
import type { PublicSiteResponse } from "@impulza/contracts";
import { themeTokensSchema, themeTokensToCssVariables } from "@impulza/validation";
import { Container } from "./ui/container";

/**
 * Envoltorio de todo sitio público: inyecta el tema del tenant como propiedades custom de CSS
 * sobre este mismo `<div>` (F2.5/F2.7) y renderiza el encabezado con el nombre del sitio y su
 * navegación (solo páginas `PUBLIC` y publicadas — F2.3). El contenido de cada página vive en
 * `children`, fuera de acá: este componente no sabe nada de bloques.
 */
export function SiteShell({ site, children }: { site: PublicSiteResponse; children: ReactNode }) {
  const tokens = themeTokensSchema.parse(site.theme.tokens);
  const cssVariables = themeTokensToCssVariables(tokens);

  return (
    <div
      style={cssVariables as CSSProperties}
      className="min-h-dvh bg-[var(--site-color-background)] text-[var(--site-color-foreground)]"
    >
      <div style={{ fontFamily: "var(--site-font-family)" }}>
        <header className="border-b border-[var(--site-color-border)]">
          <Container className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-5">
            <a href={`/${site.slug}`} className="text-lg font-semibold">
              {site.name}
            </a>
            {site.pages.length > 1 ? (
              <nav aria-label="Páginas del sitio">
                <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  {site.pages.map((page) => (
                    <li key={page.slug}>
                      <a
                        href={page.isHome ? `/${site.slug}` : `/${site.slug}/${page.slug}`}
                        className="text-[var(--site-color-muted-foreground)] hover:text-[var(--site-color-foreground)]"
                      >
                        {page.isHome ? "Inicio" : page.slug}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </Container>
        </header>

        <main>{children}</main>
      </div>
    </div>
  );
}
