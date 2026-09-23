import { env } from "../../../../../lib/env";

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

  const upstream = await fetch(`${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one" },
    body: JSON.stringify(body),
  });

  return new Response(null, { status: upstream.status });
}
