import { getPlatformBranding } from "../../lib/api";
import { MarketingHeader } from "./header";

/**
 * Cabecera comercial con la marca de la plataforma (F9.1). `MarketingHeader` es de cliente y no puede
 * pedir datos al servidor; esta envoltura sí, y así **todas** las páginas comerciales muestran la
 * misma marca (antes solo la portada la recibía).
 */
export async function BrandedMarketingHeader({ bienvenidaHref, loginHref }: { bienvenidaHref: string; loginHref: string }) {
  const branding = await getPlatformBranding();
  return <MarketingHeader bienvenidaHref={bienvenidaHref} loginHref={loginHref} branding={branding} />;
}
