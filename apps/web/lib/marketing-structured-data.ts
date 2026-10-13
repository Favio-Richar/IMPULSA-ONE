import type { PublicPlatformBrandingResponse } from "@impulza/contracts";
import { env } from "./env";

// Datos estructurados (schema.org) del SITIO COMERCIAL de Impulza One (F11, "SEO avanzado",
// decisión del propietario 2026-10-13) -- deliberadamente separado de `lib/structured-data.ts`,
// que es el de cada sitio PUBLICADO por un cliente: este archivo nunca se usa bajo
// `app/[siteSlug]/*`, solo en las páginas de marketing (`app/page.tsx`, `app/producto/page.tsx`,
// `app/planes/page.tsx`, `app/plantillas/page.tsx`...), para que el negocio de un cliente nunca
// comparta página con el `Organization` de la propia plataforma.

/** `Organization` de Impulza One, con el logo y el nombre reales de la marca (los mismos que usa
 *  el `<title>` del layout raíz, `getPlatformBranding`) -- nunca un valor fijo que se desincronice
 *  si el propietario renombra o recoloriza la plataforma desde superadministración. */
export function impulzaOrganizationNode(branding: Pick<PublicPlatformBrandingResponse, "name" | "logoLightUrl">): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: branding.name,
    url: env.PUBLIC_WEB_BASE_URL,
  };
  if (branding.logoLightUrl) {
    node.logo = branding.logoLightUrl;
  }
  return node;
}

/** `FAQPage` de una sección de preguntas frecuentes de marketing (p. ej. `/planes`) -- a
 *  diferencia de `deriveFaqNodes` de la API (`apps/api/seo-resolver.ts`), estas preguntas son
 *  texto fijo del código, no HTML de un bloque guardado por un cliente, así que no hace falta
 *  desnudar HTML. */
export function marketingFaqNode(items: ReadonlyArray<{ question: string; answer: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
