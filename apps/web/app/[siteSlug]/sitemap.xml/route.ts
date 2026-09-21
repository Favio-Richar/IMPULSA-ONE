import { getPublicSite } from "../../../lib/api";
import { env } from "../../../lib/env";
import { escapeXml } from "../../../lib/xml";

interface Params {
  params: Promise<{ siteSlug: string }>;
}

// Sin esto, Next intenta pre-renderizar esta ruta en build time con un `siteSlug` de relleno
// (`/-/sitemap.xml`) y falla el build entero porque ahí no hay ninguna API real que responder —
// un Route Handler bajo un segmento dinámico es estático por defecto salvo que se declare lo
// contrario, a diferencia de `page.tsx` (que Next ya trata como dinámico sin configurar nada acá).
export const dynamic = "force-dynamic";

/**
 * `sitemap.xml` por sitio (F2.8): solo páginas `PUBLIC` y publicadas — exactamente el mismo filtro
 * que ya aplica la navegación del sitio (`PublicSitesService.getSite`, F2.7), reutilizado acá en
 * vez de duplicado. `lastmod` es cuándo se publicó la versión vigente de cada página, no cuándo se
 * editó el borrador por última vez.
 *
 * Ruta estática (`sitemap.xml`, no `[algo]`) bajo el segmento dinámico `[siteSlug]`: Next.js
 * prioriza el segmento literal sobre `[pageSlug]`, así que esto nunca compite con una página real
 * — y un slug de página no puede colisionar con este nombre de todos modos (`pageSlugSchema` no
 * admite el punto de la extensión).
 */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { siteSlug } = await params;
  const site = await getPublicSite(siteSlug);

  if (!site) {
    return new Response(null, { status: 404 });
  }

  const entries = site.pages.map((page) => {
    const path = page.isHome ? `/${site.slug}` : `/${site.slug}/${page.slug}`;
    const loc = new URL(path, env.PUBLIC_WEB_BASE_URL).toString();
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${page.publishedAt}</lastmod>\n  </url>`;
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Mismo criterio de caché que el resto del render público (F2.7): válido hasta la próxima
      // publicación de este sitio, no por tiempo — el navegador/CDN lo revalida en la siguiente
      // visita después de un `revalidateTag` (`RevalidateWebService`).
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
