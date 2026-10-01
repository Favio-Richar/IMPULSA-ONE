import type { PublicNewsletterConfirmationResponse } from "@impulza/contracts";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

/**
 * Enlace de confirmación de la newsletter (F7.4), del lado del servidor y sin caché: el enlace es
 * una credencial. `null` = enlace inválido (mismo 404 para todo, sin pistas).
 */
export async function getNewsletterConfirmation(token: string): Promise<PublicNewsletterConfirmationResponse | null | "unavailable"> {
  const response = await fetchUpstream("newsletter-view", `${env.API_BASE_URL}/public/newsletter/${encodeURIComponent(token)}`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (!response.ok) return "unavailable";
  return (await response.json()) as PublicNewsletterConfirmationResponse;
}
