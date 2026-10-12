import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../lib/visitor-headers";

/**
 * El cliente pulsa «Pagar la seña con Webpay» en «Tu reserva» (F10.2e). El enlace firmado es la credencial; el monto nunca
 * viaja desde acá: la API crea la transacción por la seña guardada de la reserva. Reenvía la IP real (límite de tasa).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const upstream = await fetchUpstream("booking-webpay", `${env.API_BASE_URL}/public/bookings/${encodeURIComponent(token)}/webpay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "impulza-one", ...visitorProxyHeaders(request.headers) },
    body: "{}",
  });
  if (!upstream) {
    return Response.json({ message: "No pudimos iniciar el pago ahora. Intenta de nuevo en un momento." }, { status: 502 });
  }
  const payload = await upstream.json().catch(() => null);
  return Response.json(payload ?? { message: "Respuesta inesperada del servidor." }, { status: upstream.status });
}
