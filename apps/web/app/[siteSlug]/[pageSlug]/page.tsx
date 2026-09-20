import { SitePage } from "../../../components/site-page";

interface Props {
  params: Promise<{ siteSlug: string; pageSlug: string }>;
}

export default async function SiteInnerPage({ params }: Props) {
  const { siteSlug, pageSlug } = await params;
  return <SitePage siteSlug={siteSlug} pageSlug={pageSlug} />;
}
