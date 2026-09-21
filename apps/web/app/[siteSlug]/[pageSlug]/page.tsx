import type { Metadata } from "next";
import { getPublicPage } from "../../../lib/api";
import { seoToMetadata } from "../../../lib/seo-metadata";
import { SitePage } from "../../../components/site-page";

interface Props {
  params: Promise<{ siteSlug: string; pageSlug: string }>;
}

// Misma petición que hace `SitePage` más abajo (F2.8): deduplicada por Next dentro del mismo
// render (memoización de peticiones), no es una segunda ida a la red.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteSlug, pageSlug } = await params;
  const page = await getPublicPage(siteSlug, pageSlug);
  return page ? seoToMetadata(page.seo) : {};
}

export default async function SiteInnerPage({ params }: Props) {
  const { siteSlug, pageSlug } = await params;
  return <SitePage siteSlug={siteSlug} pageSlug={pageSlug} />;
}
