import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../lib/visitor-headers";

/**
 * F3.4: mismo principio que `app/api/forms/.../submissions/route.ts` — el navegador del visitante
 * nunca llama a `apps/api` directamente, ni siquiera para un clic de analítica. Reenvía tal cual;
 * la validación del tipo de evento y el registro (visitante anonimizado, ADR-004) viven en
 * `apps/api`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ siteSlug: string }> },
): Promise<Response> {
  const { siteSlug } = await params;

  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return new Response(null, { status: 400 });
  }

  const upstream = await fetchUpstream("analytics", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "impulza-one",
      // F3.6: sin esto la API vería a todos los visitantes como uno solo (este servidor).
      ...visitorProxyHeaders(request.headers),
    },
    body: JSON.stringify(body),
  });

  // La analítica es best-effort: sin API, 502 y el visitante sigue navegando como si nada.
  return new Response(null, { status: upstream ? upstream.status : 502 });
}
