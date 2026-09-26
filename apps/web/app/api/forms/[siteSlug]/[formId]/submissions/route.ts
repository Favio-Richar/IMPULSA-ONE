import { env } from "../../../../../../lib/env";
import { fetchUpstream } from "../../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../../lib/visitor-headers";

/**
 * Único punto por el que un envío de formulario del visitante llega a `apps/api` (F3.2): el
 * navegador solo conoce esta ruta, propia de `apps/web`, nunca `API_BASE_URL` — mismo principio
 * documentado en `lib/env.ts` para el resto del render público ("el navegador del visitante nunca
 * llama a la API directamente"). Reenvía el cuerpo tal cual; la validación real (contra los campos
 * del formulario, antispam, límite de tasa) vive en `apps/api` — acá no se duplica esa lógica.
 *
 * Reenvía también los datos del visitante real con el secreto compartido (F3.6,
 * `lib/visitor-headers.ts`): así el límite de tasa de `apps/api` cuenta por visitante y no por
 * este servidor (cierra la deuda de "rate limiting parcial" de F2/F3.2).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ siteSlug: string; formId: string }> },
): Promise<Response> {
  const { siteSlug, formId } = await params;

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }

  const upstream = await fetchUpstream(
    "forms",
    `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/forms/${encodeURIComponent(formId)}/submissions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "impulza-one",
        ...visitorProxyHeaders(request.headers),
      },
      body: JSON.stringify(body),
    },
  );

  if (!upstream) {
    return Response.json({ message: "No pudimos enviar el formulario ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }

  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status });
}
