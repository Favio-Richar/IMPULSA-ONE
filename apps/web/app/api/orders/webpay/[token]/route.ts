import { env } from "../../../../../lib/env";
import { fetchUpstream } from "../../../../../lib/upstream";
import { visitorProxyHeaders } from "../../../../../lib/visitor-headers";

/**
 * El comprador pulsa «Pagar con Webpay» en «Tu pedido» (F10.2d). El enlace del pedido es la credencial; el monto nunca viaja desde
 * acá: la API crea la transacción por el total guardado del pedido. Reenvía la IP real (límite de tasa por visitante).
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const upstream = await fetchUpstream("order-webpay", `${env.API_BASE_URL}/public/orders/${encodeURIComponent(token)}/webpay`, {
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
