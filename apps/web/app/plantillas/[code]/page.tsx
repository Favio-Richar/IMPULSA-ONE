import { TEMPLATE_INDUSTRY_LABELS, TEMPLATE_OBJECTIVE_LABELS } from "@impulza/validation";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "../../../components/json-ld";
import { BrandedMarketingHeader } from "../../../components/marketing/branded-header";
import { MarketingFooter } from "../../../components/marketing/footer";
import { TemplateGalleryCard } from "../../../components/marketing/template-gallery-card";
import { TemplatePagesPreview } from "../../../components/marketing/template-pages-preview";
import { getPlatformBranding, getTemplateCatalog } from "../../../lib/api";
import { getDashboardLinks, getTemplateLinks } from "../../../lib/dashboard-links";
import { env } from "../../../lib/env";
import { impulzaOrganizationNode } from "../../../lib/marketing-structured-data";
import { blocksSummary, pageTitle, templateHasSubscription, templatePageCount } from "../../../lib/template-gallery";

type Props = { params: Promise<{ code: string }> };

async function findTemplate(code: string) {
  const templates = await getTemplateCatalog();
  return { templates, template: templates.find((item) => item.code === code) };
}

/** Rubro principal en minúsculas para el título («para barbería y estética»). */
function mainIndustry(tags: readonly string[]): string {
  const tag = tags[0] as keyof typeof TEMPLATE_INDUSTRY_LABELS | undefined;
  return tag ? TEMPLATE_INDUSTRY_LABELS[tag].toLowerCase() : "tu negocio";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const { template } = await findTemplate(code);
  if (!template) return { title: "Plantilla no encontrada", robots: { index: false } };
  // El layout raíz agrega «— <marca>».
  const title = `${template.name}: plantilla de página web para ${mainIndustry(template.industryTags)}`;
  const og = `/og?${new URLSearchParams({ title: template.name, subtitle: `Plantilla para ${mainIndustry(template.industryTags)}` }).toString()}`;
  return {
    title,
    description: `${template.description} ${templatePageCount(template)} páginas listas para editar, con vistas y «me gusta». Gratis para empezar.`,
    alternates: { canonical: `/plantillas/${template.code}` },
    openGraph: { title, description: template.description, url: `/plantillas/${template.code}`, images: [{ url: og }] },
  };
}

export default async function TemplatePage({ params }: Props) {
  const { code } = await params;
  const [{ templates, template }, branding] = await Promise.all([findTemplate(code), getPlatformBranding()]);
  if (!template) notFound();

  const { registroHref, loginHref } = getDashboardLinks();
  const { useHref, panelHref } = getTemplateLinks(template.code);
  const subscription = templateHasSubscription(template);
  const pages = [{ slug: "inicio", blocks: template.blocks }, ...(template.companionPages ?? [])];
  const pageLabels = Object.fromEntries(pages.map((page) => [page.slug, page.slug === "inicio" ? "Inicio" : pageTitle(page.slug)]));
  // Relacionadas: las que comparten más rubros (y después las del mismo estilo), sin la propia.
  const related = templates
    .filter((item) => item.code !== template.code)
    .map((item) => ({ item, score: item.industryTags.filter((tag) => template.industryTags.includes(tag)).length * 2 + (item.family === template.family ? 1 : 0) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => entry.item);
  const url = `${env.PUBLIC_WEB_BASE_URL}/plantillas/${template.code}`;

  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <JsonLd
        nodes={[
          impulzaOrganizationNode(branding),
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Inicio", item: env.PUBLIC_WEB_BASE_URL },
              { "@type": "ListItem", position: 2, name: "Plantillas", item: `${env.PUBLIC_WEB_BASE_URL}/plantillas` },
              { "@type": "ListItem", position: 3, name: template.name, item: url },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "CreativeWork",
            name: template.name,
            description: template.description,
            url,
            genre: template.industryTags.map((tag) => TEMPLATE_INDUSTRY_LABELS[tag]),
            isAccessibleForFree: true,
            inLanguage: "es",
            provider: { "@type": "Organization", name: branding.name, url: env.PUBLIC_WEB_BASE_URL },
          },
        ]}
      />
      <BrandedMarketingHeader registroHref={registroHref} loginHref={loginHref} />

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-10 sm:px-6 sm:py-14">
        <nav aria-label="Ruta de navegación" className="text-sm text-[#475569]">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <Link href="/" className="hover:text-[#0f172a] hover:underline">
                Inicio
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/plantillas#galeria" className="hover:text-[#0f172a] hover:underline">
                Plantillas
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="font-medium text-[#0f172a]">
              {template.name}
            </li>
          </ol>
        </nav>

        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-8">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-[#0f6f6b]">Plantilla para {template.industryTags.map((tag) => TEMPLATE_INDUSTRY_LABELS[tag].toLowerCase()).join(" · ")}</p>
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{template.name}</h1>
              <p className="max-w-2xl text-lg text-[#475569]">{template.description}</p>
              <ul className="flex flex-wrap gap-2" aria-label="Detalles">
                <li className={`rounded-full px-3 py-1 text-sm font-semibold ${subscription ? "bg-[#e6f5f3] text-[#0b5450]" : "border border-[#e2e8f0] text-[#475569]"}`}>
                  {subscription ? "Con suscripción" : "Sin suscripción"}
                </li>
                <li className="rounded-full border border-[#e2e8f0] px-3 py-1 text-sm font-medium text-[#475569]">{pages.length} páginas</li>
                <li className="rounded-full border border-[#e2e8f0] px-3 py-1 text-sm font-medium text-[#475569]">Tema {template.theme.name}</li>
              </ul>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a
                href={useHref}
                className="inline-flex min-h-12 items-center justify-center rounded-[10px] bg-[#0f6f6b] px-6 text-base font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f6f6b]"
              >
                Usar esta plantilla gratis
              </a>
              <a
                href={panelHref}
                className="inline-flex min-h-12 items-center justify-center rounded-[10px] border border-[#cbd5e1] px-6 text-base font-semibold text-[#0f172a] hover:bg-[#f1f5f9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f6f6b]"
              >
                Ya tengo cuenta: usarla en mi panel
              </a>
            </div>

            <section aria-labelledby="incluye" className="flex flex-col gap-4">
              <h2 id="incluye" className="text-xl font-semibold">
                Qué incluye
              </h2>
              <ol className="flex flex-col gap-3">
                {pages.map((page, index) => (
                  <li key={page.slug} className="flex gap-4 rounded-2xl border border-[#e2e8f0] p-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f1f5f9] text-sm font-semibold tabular-nums text-[#0f172a]">{index + 1}</span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <h3 className="font-semibold">
                        {pageLabels[page.slug]} <span className="font-normal text-[#64748b]">{page.slug === "inicio" ? "· tu página principal" : `· /${page.slug}`}</span>
                      </h3>
                      <p className="text-sm text-[#475569]">{blocksSummary(page.blocks).join(", ")}.</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section aria-labelledby="ideal" className="flex flex-col gap-3">
              <h2 id="ideal" className="text-xl font-semibold">
                Pensada para
              </h2>
              <ul className="flex flex-wrap gap-2">
                {template.objectiveTags.map((objective) => (
                  <li key={objective} className="rounded-[10px] bg-[#f1f5f9] px-3 py-1.5 text-sm text-[#0f172a]">
                    {TEMPLATE_OBJECTIVE_LABELS[objective]}
                  </li>
                ))}
              </ul>
              <p className="max-w-2xl text-sm text-[#475569]">
                Todo se edita después: textos, fotos, colores, fuentes y bloques. Las fotos y textos de ejemplo se reemplazan por los
                tuyos desde el panel.
              </p>
            </section>
          </div>

          <div className="lg:sticky lg:top-24">
            <TemplatePagesPreview template={template} pageLabels={pageLabels} />
          </div>
        </div>

        {related.length > 0 ? (
          <section aria-labelledby="relacionadas" className="flex flex-col gap-6 border-t border-[#e2e8f0] pt-12">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="relacionadas" className="text-2xl font-semibold tracking-tight">
                Plantillas parecidas
              </h2>
              <Link href="/plantillas#galeria" className="text-sm font-semibold text-[#0f6f6b] hover:underline">
                Ver toda la galería
              </Link>
            </div>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((item) => (
                <li key={item.code}>
                  <TemplateGalleryCard template={item} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      <MarketingFooter registroHref={registroHref} loginHref={loginHref} />
    </div>
  );
}
