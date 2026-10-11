import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../lib/visitor-headers";

/**
 * El visitante pide su enlace de acceso (F10.1). Reenvía el correo y la IP real (para el límite de tasa por visitante);
 * la API responde lo mismo exista o no como miembro, y acá no se agrega nada que lo delate. Nunca registra el cuerpo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }

  const upstream = await fetchUpstream("members-access", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/members/access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: JSON.stringify(body),
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos enviar el enlace ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status });
}
