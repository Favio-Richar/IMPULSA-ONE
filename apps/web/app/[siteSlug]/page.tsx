import type { Metadata } from "next";
import { HOME_PAGE_SLUG } from "@impulza/validation";
import { getPublicPage } from "../../lib/api";
import { seoToMetadata } from "../../lib/seo-metadata";
import { SitePage } from "../../components/site-page";

interface Props {
  params: Promise<{ siteSlug: string }>;
}

// Misma petición que hace `SitePage` más abajo (F2.8): deduplicada por Next dentro del mismo
// render (memoización de peticiones), no es una segunda ida a la red.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteSlug } = await params;
  const page = await getPublicPage(siteSlug, HOME_PAGE_SLUG);
  return page ? seoToMetadata(page.seo) : {};
}

export default async function SiteHomePage({ params }: Props) {
  const { siteSlug } = await params;
  return <SitePage siteSlug={siteSlug} pageSlug={HOME_PAGE_SLUG} />;
}
