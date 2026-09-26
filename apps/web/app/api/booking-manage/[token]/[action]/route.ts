import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../lib/visitor-headers";

// Cancelar o cambiar la hora desde "Tu reserva" (F5.4). Solo esas dos acciones; la validación real
// (firma del enlace, plazo, hora libre) vive en apps/api.
const ACTIONS = new Set(["cancel", "reschedule"]);

export async function POST(request: Request, { params }: { params: Promise<{ token: string; action: string }> }): Promise<Response> {
  const { token, action } = await params;
  if (!ACTIONS.has(action)) {
    return Response.json({ message: "Acción desconocida." }, { status: 404 });
  }
  const body = action === "reschedule" ? await request.json().catch(() => null) : {};
  if (body === null || typeof body !== "object") {
    return Response.json({ message: "Cuerpo inválido." }, { status: 400 });
  }
  const upstream = await fetchUpstream("booking-manage", `${env.API_BASE_URL}/public/bookings/${encodeURIComponent(token)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: JSON.stringify(body),
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos hacer el cambio ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status, headers: { "Cache-Control": "no-store" } });
}
