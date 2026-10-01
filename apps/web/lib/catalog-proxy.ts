import { env } from "./env";
import { fetchUpstream } from "./upstream";
import { visitorProxyHeaders } from "./visitor-headers";

/**
 * Reenvía un POST público del catálogo a apps/api (F7.8c). Toda la validación — productos, precios,
 * stock, cupón, antispam y límite de tasa — vive en la API; aquí solo se valida que el cuerpo sea JSON
 * y se agregan la cabecera anti-CSRF y las del visitante. `failMessage` es lo que ve el visitante si la
 * API no responde (nunca sus datos en un registro).
 */
export async function forwardCatalogPost(request: Request, siteSlug: string, subpath: string, failMessage: string): Promise<Response> {
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }
  const upstream = await fetchUpstream("catalog", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/catalog/${subpath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: JSON.stringify(body),
  });
  if (!upstream) {
    return Response.json({ message: failMessage }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
