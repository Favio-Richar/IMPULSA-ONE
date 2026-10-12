import { publicDigitalCardResponse, type PublicDigitalCardResponse } from "@impulza/contracts";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

// Tarjeta digital pública (F10.4). Del lado del servidor y sin caché de datos: el negocio puede desactivarla o cambiarla.

const root = (siteSlug: string): string => `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/card`;

/** `null` = no existe o no está activa; `"unavailable"` = la API no respondió. */
export async function getDigitalCard(siteSlug: string): Promise<PublicDigitalCardResponse | null | "unavailable"> {
  const response = await fetchUpstream("digital-card", root(siteSlug), { headers: { "X-Requested-With": "impulza-one" }, cache: "no-store" });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (!response.ok) return "unavailable";
  return publicDigitalCardResponse.parse(await response.json());
}

export function cardApiUrl(siteSlug: string, suffix: "vcard" | "wallet/google" | "wallet/apple"): string {
  return `${root(siteSlug)}/${suffix}`;
}

/** Dígitos de un teléfono E.164, para `wa.me`. */
export function whatsappDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}
