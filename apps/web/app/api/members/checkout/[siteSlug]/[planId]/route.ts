import { env } from "../../../../../../lib/env";
import { fetchUpstream } from "../../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../../lib/visitor-headers";

/**
 * El visitante empieza la compra de una membresía (F10.2). Reenvía el correo y la IP real (límite de tasa por visitante); el precio
 * nunca viaja desde acá: la API lo toma del plan guardado. Nunca registra el cuerpo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string; planId: string }> }): Promise<Response> {
  const { siteSlug, planId } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }

  const upstream = await fetchUpstream(
    "members-checkout",
    `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/members/plans/${encodeURIComponent(planId)}/checkout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
      body: JSON.stringify(body),
    },
  );
  if (!upstream) {
    return Response.json({ message: "No pudimos iniciar el pago ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status });
}
