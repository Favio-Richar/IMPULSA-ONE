import { getPublicSite } from "../../../lib/api";
import { env } from "../../../lib/env";

interface Params {
  params: Promise<{ siteSlug: string }>;
}

// Mismo motivo que `sitemap.xml/route.ts`: sin esto, Next intenta pre-renderizarla en build time
// con un `siteSlug` de relleno y el build entero falla porque ahí no hay ninguna API real.
export const dynamic = "force-dynamic";

/**
 * `robots.txt` por sitio (F2.8), con una limitación real que hay que tener presente: el estándar
 * (RFC 9309) dice que un crawler solo busca `robots.txt` en la **raíz del host**
 * (`https://host/robots.txt`), nunca en un subpath — así que mientras el hosting sea por path
 * (`impulza.one/mi-sitio`, sin dominio propio todavía; `SiteDomain` existe en el modelo desde F2.1
 * pero no hay ruteo por dominio propio hasta que exista esa fase) esta ruta no es la que Google ni
 * Bing van a descubrir solos. Sirve igual para: (a) envío manual a Search Console (que sí admite
 * verificar y monitorear un prefijo de URL, no solo un host), y (b) el día que un sitio tenga
 * dominio propio y esta pase a ser, literalmente, la raíz de ese host. El control real de indexado
 * por página ya está cubierto aparte por `<meta name="robots">` (`seoToMetadata`), que un crawler
 * sí respeta sin importar el path.
 */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { siteSlug } = await params;
  const site = await getPublicSite(siteSlug);

  if (!site) {
    return new Response(null, { status: 404 });
  }

  const sitemapUrl = new URL(`/${site.slug}/sitemap.xml`, env.PUBLIC_WEB_BASE_URL).toString();
  const body = ["User-agent: *", "Allow: /", "", `Sitemap: ${sitemapUrl}`, ""].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
