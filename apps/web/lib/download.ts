import type { PublicDownloadResponse } from "@impulza/contracts";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

/**
 * Descarga de un pedido (F5.11b, ADR-015): estado para la página, sin contar una descarga. Del lado
 * del servidor y sin caché: el enlace es una credencial. `null` = enlace inválido.
 */
export async function getDownload(token: string): Promise<PublicDownloadResponse | null | "unavailable"> {
  const response = await fetchUpstream("download", `${env.API_BASE_URL}/public/downloads/${encodeURIComponent(token)}`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (!response.ok) return "unavailable";
  return (await response.json()) as PublicDownloadResponse;
}
