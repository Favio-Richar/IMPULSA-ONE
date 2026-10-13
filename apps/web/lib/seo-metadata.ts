import type { Metadata } from "next";
import type { PublicSeoResponse } from "@impulza/contracts";

// Traduce el SEO ya resuelto por la API (F2.8, `resolveSeo` en apps/api) al `Metadata` de Next.
// Nada de lo que hay acá decide valores por defecto de CONTENIDO (título, descripción...): eso ya
// pasó del lado del servidor de la API, para que un cliente futuro (no solo apps/web) que consuma
// `GET /public/sites/*` reciba el mismo SEO resuelto sin tener que reimplementar esta lógica. La
// única excepción es la imagen de Open Graph de respaldo (F11, "SEO avanzado", decisión del
// propietario 2026-10-13): dibujar una imagen es, en sí mismo, una decisión de presentación de
// ESTE proceso (`app/og/route.tsx`, con `next/og`), no un dato que la API pueda resolver sin
// asumir cómo se ve -- por eso vive acá y no en `resolveSeo`.

const ROBOTS_BY_VALUE: Record<PublicSeoResponse["robots"], { index: boolean; follow: boolean }> = {
  index_follow: { index: true, follow: true },
  noindex_follow: { index: false, follow: true },
  index_nofollow: { index: true, follow: false },
  noindex_nofollow: { index: false, follow: false },
};

/** URL relativa (Next la resuelve contra `metadataBase`) de la imagen de respaldo cuando la
 *  página no tiene una propia -- el título real y, si lo hay, el nombre del sitio, para que ni
 *  siquiera el respaldo sea una imagen genérica sin relación con el contenido. */
function fallbackOpenGraphImage(title: string, siteName?: string): string {
  const params = new URLSearchParams({ title });
  if (siteName && siteName !== title) {
    params.set("subtitle", siteName);
  }
  return `/og?${params.toString()}`;
}

export function seoToMetadata(seo: PublicSeoResponse, options: { siteName?: string } = {}): Metadata {
  const ogImage = seo.openGraph.image ?? fallbackOpenGraphImage(seo.openGraph.title, options.siteName);
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
      images: [{ url: ogImage }],
    },
  };
}
