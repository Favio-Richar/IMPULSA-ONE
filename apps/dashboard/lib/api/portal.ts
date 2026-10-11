import type { PublicPlatformBrandingResponse, PublicPortalResolution } from "@impulza/contracts";
import { customDomainSchema } from "@impulza/validation";
import { apiFetch } from "../api-client";

/**
 * Marca del portal de una agencia para el host con que se visita el panel (F9.7d/e, ADR-028 §5). Solo responde si ese host es un dominio de
 * portal VERIFICADO de una agencia activa; en cualquier otro caso (la plataforma, localhost, un dominio sin verificar) devuelve `null` y
 * las pantallas de acceso usan la marca de la plataforma. Nunca lanza: la marca no puede impedir el acceso.
 */
export async function getPortalBrand(host: string | null): Promise<PublicPortalResolution["brand"] | null> {
  if (!host) return null;
  const hostname = host.split(":")[0] ?? "";
  // Solo nombres públicos válidos (sin localhost, IPs ni puertos): lo mismo que acepta el servidor.
  const parsed = customDomainSchema.safeParse(hostname);
  if (!parsed.success) return null;
  try {
    const result = await apiFetch<PublicPortalResolution>(`/public/portal/${encodeURIComponent(parsed.data)}`);
    return result.brand;
  } catch {
    return null;
  }
}

/** La marca de la plataforma con los datos de marca de la agencia encima (nombre, logos y colores); lo legal no cambia. */
export function withPortalBrand(platform: PublicPlatformBrandingResponse, brand: NonNullable<Awaited<ReturnType<typeof getPortalBrand>>>): PublicPlatformBrandingResponse {
  return {
    ...platform,
    name: brand.displayName,
    logoLightUrl: brand.logoLightUrl,
    logoDarkUrl: brand.logoDarkUrl,
    faviconUrl: brand.faviconUrl,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    footerText: brand.footerText ?? platform.footerText ?? null,
  };
}
