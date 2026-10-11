import { env } from "../../../../lib/env";
import { fetchUpstream } from "../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../lib/visitor-headers";

/**
 * Único punto por el que un reporte de abuso del visitante llega a `apps/api` (F9.9d): el navegador solo conoce
 * esta ruta, nunca `API_BASE_URL`. Reenvía el cuerpo tal cual y la IP real del visitante con el secreto compartido
 * (así el límite de tasa y la repetición por visitante cuentan por persona y no por este servidor). La validación
 * real (catálogo de motivos, saneamiento, límites) vive en `apps/api`; acá no se duplica.
 *
 * Nunca registra el cuerpo: puede traer un correo y un texto libre.
 */
export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }

  const upstream = await fetchUpstream("abuse-reports", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/abuse-reports`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "impulza-one",
      ...visitorProxyHeaders(request.headers),
    },
    body: JSON.stringify(body),
  });

  if (!upstream) {
    return Response.json({ message: "No pudimos enviar el reporte ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }

  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status });
}
