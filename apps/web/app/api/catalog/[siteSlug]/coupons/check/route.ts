import { env } from "../../../../../../lib/env";
import { fetchUpstream } from "../../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../../lib/visitor-headers";

// Probar un código de descuento desde el sitio público (F7.8b, ADR-023). El cálculo, la respuesta
// uniforme y el tope por visitante viven en apps/api; aquí solo se reenvía.

export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }
  const upstream = await fetchUpstream("catalog", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/catalog/coupons/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: JSON.stringify(body),
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos revisar el código ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
