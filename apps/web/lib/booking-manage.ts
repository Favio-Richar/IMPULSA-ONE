import type { PublicManagedBookingResponse } from "@impulza/contracts";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

/**
 * Reserva que el cliente gestiona con el enlace de su correo (F5.4). Del lado del servidor y sin
 * caché: el estado cambia (cancelar, reprogramar) y el enlace es una credencial, no contenido
 * público. `null` = enlace inválido o reserva inexistente (mismo 404 para todo, sin pistas).
 */
export async function getManagedBooking(token: string): Promise<PublicManagedBookingResponse | null | "unavailable"> {
  const response = await fetchUpstream("booking-manage", `${env.API_BASE_URL}/public/bookings/${encodeURIComponent(token)}`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (!response.ok) return "unavailable";
  return (await response.json()) as PublicManagedBookingResponse;
}
