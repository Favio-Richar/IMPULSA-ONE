import type { PublicUnsubscribeResponse } from "@impulza/contracts";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

/**
 * Enlace de baja de campañas (F5.6), del lado del servidor y sin caché: el enlace es una credencial.
 * `null` = enlace inválido (mismo 404 para todo, sin pistas).
 */
export async function getUnsubscribe(token: string): Promise<PublicUnsubscribeResponse | null | "unavailable"> {
  const response = await fetchUpstream("unsubscribe", `${env.API_BASE_URL}/public/unsubscribe/${encodeURIComponent(token)}`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (!response.ok) return "unavailable";
  return (await response.json()) as PublicUnsubscribeResponse;
}
