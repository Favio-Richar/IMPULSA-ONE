import { env } from "../../../../lib/env";
import { fetchUpstream } from "../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../lib/visitor-headers";

// Reservas del sitio público (F5.2). Único camino del navegador del visitante hacia la API de
// reservas: mismo criterio que `api/forms` (el navegador nunca conoce `API_BASE_URL`). La
// validación real — servicio, hora libre, datos, antispam, límite de tasa — vive en apps/api.

function upstreamUrl(siteSlug: string): string {
  return `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/booking`;
}

async function relay(upstream: Response | null, unavailable: string): Promise<Response> {
  if (!upstream) {
    return Response.json({ message: unavailable }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}

/** Servicios reservables del sitio. */
export async function GET(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const upstream = await fetchUpstream("bookings", upstreamUrl(siteSlug), {
    headers: { "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    cache: "no-store",
  });
  return relay(upstream, "No pudimos cargar las reservas ahora. Intenta de nuevo en un momento.");
}

/** Reservar. */
export async function POST(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }
  const upstream = await fetchUpstream("bookings", upstreamUrl(siteSlug), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: JSON.stringify(body),
  });
  return relay(upstream, "No pudimos confirmar tu reserva ahora. Intenta de nuevo en un momento.");
}
