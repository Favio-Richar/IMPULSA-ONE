import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../lib/visitor-headers";

// Horarios libres de un servicio (F5.2). Solo se reenvían los tres parámetros conocidos; la API los
// vuelve a validar.
export async function GET(request: Request, { params }: { params: Promise<{ siteSlug: string }> }): Promise<Response> {
  const { siteSlug } = await params;
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ["serviceId", "from", "days"]) {
    const value = incoming.get(key);
    if (value !== null) {
      query.set(key, value);
    }
  }
  const upstream = await fetchUpstream(
    "bookings-availability",
    `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/booking/availability?${query.toString()}`,
    { headers: { "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) }, cache: "no-store" },
  );
  if (!upstream) {
    return Response.json({ message: "No pudimos cargar los horarios ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
