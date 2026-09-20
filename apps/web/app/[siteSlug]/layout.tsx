import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getPublicSite } from "../../lib/api";
import { SiteShell } from "../../components/site-shell";

interface Props {
  children: ReactNode;
  params: Promise<{ siteSlug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteSlug } = await params;
  const site = await getPublicSite(siteSlug);

  if (!site) {
    return {};
  }

  return { title: { default: site.name, template: `%s · ${site.name}` } };
}

/**
 * Resuelve el sitio **una vez** por árbol de rutas: la home (`page.tsx`) y cada página interna
 * (`[pageSlug]/page.tsx`) llaman a `getPublicSite` de nuevo para leer el tema, pero es la misma
 * URL con las mismas opciones — Next la deduplica dentro del mismo render (memoización de
 * peticiones), así que no hay una segunda ida a la red.
 *
 * A propósito, este segmento **no tiene** `loading.tsx`: verificado en caliente contra un build
 * real, un `loading.tsx` envuelve el segmento en un límite de Suspense, y una vez que ese límite
 * empieza a transmitir la respuesta en 200, el código de estado ya no puede cambiar a 404 aunque
 * `notFound()` se dispare después (documentado en la referencia de `notFound()` de Next.js —
 * "the response has already begun streaming as a 200, and the status can't change"). El criterio
 * de aceptación de F2.7 exige un 404 real, no uno blando con `noindex`, así que acá se prioriza
 * eso sobre un esqueleto de carga: la respuesta bloquea hasta tener sitio y página resueltos.
 */
export default async function SiteLayout({ children, params }: Props) {
  const { siteSlug } = await params;
  const site = await getPublicSite(siteSlug);

  if (!site) {
    notFound();
  }

  return <SiteShell site={site}>{children}</SiteShell>;
}
