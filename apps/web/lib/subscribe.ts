import { publicSubscribePageResponse, type PublicSubscribePageResponse } from "@impulza/contracts";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

// Página de suscripción pública. Del lado del servidor y sin caché de datos: el negocio puede desactivarla o cambiarla.

/** `null` = no existe o no está activa; `"unavailable"` = la API no respondió. */
export async function getSubscribePage(siteSlug: string): Promise<PublicSubscribePageResponse | null | "unavailable"> {
  const response = await fetchUpstream("subscribe-page", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/subscribe`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (!response.ok) return "unavailable";
  return publicSubscribePageResponse.parse(await response.json());
}
