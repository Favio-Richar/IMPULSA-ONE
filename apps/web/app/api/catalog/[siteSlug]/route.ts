import { env } from "../../../../lib/env";
import { fetchUpstream } from "../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../lib/visitor-headers";

// Catálogo del sitio público (F5.5). Único camino del navegador del visitante hacia la API del
// catálogo: mismo criterio que `api/bookings` (el navegador nunca conoce `API_BASE_URL`).

/** Productos a la venta del sitio. */
export async function GET(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const upstream = await fetchUpstream("catalog", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/catalog`, {
    headers: { "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    cache: "no-store",
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos cargar los productos ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
