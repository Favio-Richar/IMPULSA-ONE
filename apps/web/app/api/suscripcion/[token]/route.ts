import { env } from "../../../../lib/env";
import { fetchUpstream } from "../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../lib/visitor-headers";

// Confirmar la suscripción (F7.4, ADR-019): el botón de `/suscripcion/:token` llama acá. Sin cuerpo:
// la credencial es el enlace del correo, y la validación vive en `apps/api`.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const upstream = await fetchUpstream("newsletter-confirm", `${env.API_BASE_URL}/public/newsletter/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos confirmar ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
