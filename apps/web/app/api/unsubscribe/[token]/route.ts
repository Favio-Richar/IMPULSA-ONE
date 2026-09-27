import { env } from "../../../../lib/env";
import { fetchUpstream } from "../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../lib/visitor-headers";

// Baja de campañas (F5.6): la usa el botón de `/baja/:token` y también el "darse de baja con un
// clic" de los clientes de correo (RFC 8058: POST con `List-Unsubscribe=One-Click`, sin JSON). Se
// reenvía sin cuerpo: la credencial es el enlace firmado y la validación vive en apps/api.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const upstream = await fetchUpstream("unsubscribe", `${env.API_BASE_URL}/public/unsubscribe/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos registrar tu baja ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
