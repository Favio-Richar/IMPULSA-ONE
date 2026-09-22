import { notFound } from "next/navigation";
import { PageBlocks } from "@impulza/blocks-renderer";
import { themeTokensSchema } from "@impulza/validation";
import { getPublicPage, getPublicSite } from "../lib/api";

/**
 * Cuerpo compartido de la home (`app/[siteSlug]/page.tsx`) y de cualquier otra página
 * (`app/[siteSlug]/[pageSlug]/page.tsx`) — la única diferencia entre ambas rutas es qué slug de
 * página le pasan acá; todo lo demás (buscar la página, 404 si no está publicada, pintar sus
 * bloques con el tema del sitio) es exactamente el mismo trabajo.
 */
export async function SitePage({ siteSlug, pageSlug }: { siteSlug: string; pageSlug: string }) {
  const [site, page] = await Promise.all([
    getPublicSite(siteSlug),
    getPublicPage(siteSlug, pageSlug),
  ]);

  // El layout ya llama a `getPublicSite` y hace `notFound()` si el sitio no existe (deduplicado,
  // no es una segunda petición) — acá solo falta comprobar la página en sí.
  if (!site || !page) {
    notFound();
  }

  const tokens = themeTokensSchema.parse(site.theme.tokens);

  return <PageBlocks blocks={page.blocks} buttonStyle={tokens.buttonStyle} />;
}
