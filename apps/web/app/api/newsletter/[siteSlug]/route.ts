import { env } from "../../../../lib/env";
import { fetchUpstream } from "../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../lib/visitor-headers";

// Suscripción a la newsletter (F7.4, ADR-019): el bloque de la página pública envía acá; se reenvía
// tal cual a `apps/api`, con los datos del visitante para que el límite de tasa cuente por persona.
export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }
  const upstream = await fetchUpstream("newsletter", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/newsletter`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: JSON.stringify(body),
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos registrar tu suscripción ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
