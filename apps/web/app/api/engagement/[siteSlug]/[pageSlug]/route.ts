import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../lib/visitor-headers";

/**
 * Vistas y «me gusta» de una página (F10). Reenvía a la API con la IP real del visitante (límite de tasa y clave del
 * «me gusta» por visitante) y nunca guarda ni registra nada. Sin caché: la respuesta depende de quién pregunta.
 */
async function forward(request: Request, params: Promise<{ siteSlug: string; pageSlug: string }>, method: "GET" | "PUT" | "DELETE"): Promise<Response> {
  const { siteSlug, pageSlug } = await params;
  const upstream = await fetchUpstream(
    "engagement",
    `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/pages/${encodeURIComponent(pageSlug)}/engagement`,
    { method, headers: { "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) }, cache: "no-store" },
  );
  if (!upstream) return Response.json({ message: "No disponible por ahora." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}

type Context = { params: Promise<{ siteSlug: string; pageSlug: string }> };

export function GET(request: Request, { params }: Context): Promise<Response> {
  return forward(request, params, "GET");
}
export function PUT(request: Request, { params }: Context): Promise<Response> {
  return forward(request, params, "PUT");
}
export function DELETE(request: Request, { params }: Context): Promise<Response> {
  return forward(request, params, "DELETE");
}
