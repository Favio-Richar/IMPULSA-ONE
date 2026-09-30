import type { PublicOrderStatusResponse } from "@impulza/contracts";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

/**
 * Pedido que el comprador sigue con el enlace de su correo o al volver de Mercado Pago (F5.9). Del
 * lado del servidor y sin caché: el estado cambia al confirmarse el pago y el enlace es una
 * credencial. `paymentId` es el `payment_id` con que vuelve Mercado Pago: la API lo consulta con el
 * token del negocio (lo que diga la URL nunca se toma como verdad). `null` = enlace inválido.
 */
export async function getOrderStatus(token: string, paymentId?: string): Promise<PublicOrderStatusResponse | null | "unavailable"> {
  const query = paymentId && /^\d{1,30}$/.test(paymentId) ? `?paymentId=${paymentId}` : "";
  const response = await fetchUpstream("order-status", `${env.API_BASE_URL}/public/orders/${encodeURIComponent(token)}${query}`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (!response.ok) return "unavailable";
  return (await response.json()) as PublicOrderStatusResponse;
}
