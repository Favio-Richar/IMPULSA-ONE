import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../lib/visitor-headers";

// Pedido desde el sitio público (F5.5). La validación real — producto, precio, stock, datos,
// antispam, límite de tasa — vive en apps/api; aquí solo se reenvía.

/** Hacer un pedido. */
export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }
  const upstream = await fetchUpstream("catalog", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/catalog/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: JSON.stringify(body),
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos enviar tu pedido ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
