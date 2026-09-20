import { HOME_PAGE_SLUG } from "@impulza/validation";
import { SitePage } from "../../components/site-page";

interface Props {
  params: Promise<{ siteSlug: string }>;
}

export default async function SiteHomePage({ params }: Props) {
  const { siteSlug } = await params;
  return <SitePage siteSlug={siteSlug} pageSlug={HOME_PAGE_SLUG} />;
}
