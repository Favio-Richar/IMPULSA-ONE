import type { Metadata } from "next";
import type { PublicSeoResponse } from "@impulza/contracts";

// Traduce el SEO ya resuelto por la API (F2.8, `resolveSeo` en apps/api) al `Metadata` de Next.
// Nada de lo que hay acá decide valores por defecto: eso ya pasó del lado del servidor de la API,
// para que un cliente futuro (no solo apps/web) que consuma `GET /public/sites/*` reciba el mismo
// SEO resuelto sin tener que reimplementar esta lógica.

const ROBOTS_BY_VALUE: Record<PublicSeoResponse["robots"], { index: boolean; follow: boolean }> = {
  index_follow: { index: true, follow: true },
  noindex_follow: { index: false, follow: true },
  index_nofollow: { index: true, follow: false },
  noindex_nofollow: { index: false, follow: false },
};

export function seoToMetadata(seo: PublicSeoResponse): Metadata {
  return {
    title: seo.title,
    description: seo.description,
    // Ruta relativa: Next la resuelve contra `metadataBase` (`app/layout.tsx`), nunca contra el
    // header `Host` de la petición.
    alternates: { canonical: seo.canonicalPath },
    robots: ROBOTS_BY_VALUE[seo.robots],
    openGraph: {
      title: seo.openGraph.title,
      description: seo.openGraph.description,
      url: seo.canonicalPath,
      images: seo.openGraph.image ? [{ url: seo.openGraph.image }] : undefined,
    },
  };
}
