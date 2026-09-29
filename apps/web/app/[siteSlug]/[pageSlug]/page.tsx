import type { Metadata } from "next";
import { getPublicPage } from "../../../lib/api";
import { seoToMetadata } from "../../../lib/seo-metadata";
import { SitePage, utmFrom } from "../../../components/site-page";

interface Props {
  // F6.6: la campaña de la visita (utm_source / utm_campaign) decide reglas de Smart CTA.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ siteSlug: string; pageSlug: string }>;
}

// Misma petición que hace `SitePage` más abajo (F2.8): deduplicada por Next dentro del mismo
// render (memoización de peticiones), no es una segunda ida a la red.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteSlug, pageSlug } = await params;
  const page = await getPublicPage(siteSlug, pageSlug);
  return page ? seoToMetadata(page.seo) : {};
}

export default async function SiteInnerPage({ params, searchParams }: Props) {
  const { siteSlug, pageSlug } = await params;
  return <SitePage siteSlug={siteSlug} pageSlug={pageSlug} utm={utmFrom(await searchParams)} />;
}
