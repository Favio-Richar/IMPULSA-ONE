import type { PublicMembershipPlansResponse, PublicMembershipStatusResponse } from "@impulza/contracts";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

/**
 * «Tu membresía» (F10.2): con el enlace del correo o al volver de Mercado Pago. Del lado del servidor y sin caché: el estado cambia al
 * confirmarse el pago y el enlace es una credencial. `paymentId` lo consulta la API con el token del negocio (la URL nunca es verdad).
 * `null` = enlace inválido.
 */
export async function getMembershipStatus(token: string, paymentId?: string): Promise<PublicMembershipStatusResponse | null | "unavailable"> {
  const query = paymentId && /^\d{1,30}$/.test(paymentId) ? `?paymentId=${paymentId}` : "";
  const response = await fetchUpstream("membership-status", `${env.API_BASE_URL}/public/memberships/purchases/${encodeURIComponent(token)}${query}`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (!response.ok) return "unavailable";
  return (await response.json()) as PublicMembershipStatusResponse;
}

/** Planes que se pueden comprar ahora. Sin caché (el negocio puede cambiarlos o conectar su cuenta). Ante cualquier falla, sin planes. */
export async function getMemberPlans(siteSlug: string): Promise<PublicMembershipPlansResponse> {
  const none: PublicMembershipPlansResponse = { checkoutAvailable: false, plans: [] };
  const response = await fetchUpstream("member-plans", `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/members/plans`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response || !response.ok) return none;
  return (await response.json().catch(() => none)) as PublicMembershipPlansResponse;
}
