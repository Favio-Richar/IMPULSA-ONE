import { buildManifest } from "@impulza/pwa";
import { themeTokensSchema } from "@impulza/validation";
import { getPublicSite } from "../../../lib/api";

/**
 * Manifiesto de la app instalable de un sitio (F10.5): el sitio como app, con su nombre y sus colores. Solo sale de datos públicos
 * del sitio publicado; uno que no existe responde 404, igual que su página.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const site = await getPublicSite(siteSlug);
  if (!site) return new Response("Sitio no encontrado.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

  const tokens = themeTokensSchema.safeParse(site.theme.tokens);
  const manifest = buildManifest({
    name: site.name,
    description: `Sitio de ${site.name}.`,
    startUrl: `/${site.slug}/`,
    scope: `/${site.slug}/`,
    themeColor: tokens.success ? tokens.data.palette.primary : undefined,
    backgroundColor: tokens.success ? tokens.data.palette.background : undefined,
  });
  return new Response(JSON.stringify(manifest), {
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
