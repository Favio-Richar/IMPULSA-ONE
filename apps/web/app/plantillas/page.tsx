import { BrandedMarketingHeader } from "../../components/marketing/branded-header";
import { MarketingHeroBackground, MarketingCtaBackground } from "../../components/marketing/hero-background";
import { MarketingFooter } from "../../components/marketing/footer";
import { Reveal } from "../../components/marketing/reveal";
import { GalleryPagination } from "../../components/marketing/gallery-pagination";
import { TemplateGalleryFilters } from "../../components/marketing/template-gallery";
import { TemplateGalleryCard } from "../../components/marketing/template-gallery-card";
import { getDashboardLinks, getTemplateLinks } from "../../lib/dashboard-links";
import { getTemplateCatalog, getPlatformBranding } from "../../lib/api";
import { RubrosCarousel } from "../../components/marketing/rubros-carousel";
import { JsonLd } from "../../components/json-ld";
import { impulzaOrganizationNode } from "../../lib/marketing-structured-data";
import { filterTemplates, galleryHref, hasActiveFilters, industriesInCatalog, paginate, parseGalleryQuery, TEMPLATES_PER_PAGE } from "../../lib/template-gallery";
import type { Metadata } from "next";
import Link from "next/link";

const OG_TITLE = "Plantillas";
const OG_SUBTITLE = "Plantillas reales del catálogo, filtradas por rubro";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * SEO de la galería: la primera página sin filtros es la canónica. Las páginas 2, 3… se indexan con su propia dirección (cada una
 * enlaza plantillas distintas); una vista filtrada no se indexa (sería contenido repetido) pero sus enlaces sí se siguen.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const query = parseGalleryQuery(await searchParams);
  const filtered = hasActiveFilters(query);
  return {
    // El layout raíz agrega «— <marca>» (plantilla de título): acá va solo el nombre de la página.
    title: query.pagina > 1 && !filtered ? `Plantillas (página ${query.pagina})` : "Plantillas",
    description: "Elige una plantilla real del catálogo de Impulza One, filtrada por rubro y por si trae suscripción, y hazla tuya en el asistente de bienvenida.",
    alternates: { canonical: filtered ? "/plantillas" : galleryHref({ ...query, rubro: null, suscripcion: "todas", q: "" }) },
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
    openGraph: { images: [{ url: `/og?${new URLSearchParams({ title: OG_TITLE, subtitle: OG_SUBTITLE }).toString()}` }] },
  };
}

export default async function PlantillasPage({ searchParams }: Props) {
  const [templates, branding] = await Promise.all([getTemplateCatalog(), getPlatformBranding()]);
  const { registroHref, loginHref } = getDashboardLinks();
  const query = parseGalleryQuery(await searchParams);
  const results = paginate(filterTemplates(templates, query), query.pagina);

  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <JsonLd nodes={[impulzaOrganizationNode(branding)]} />
      <BrandedMarketingHeader registroHref={registroHref} loginHref={loginHref} />

      {/* Portada: un rubro por diapositiva, cada uno con su plantilla real. */}
      <RubrosCarousel registroHref={registroHref} />

      <section className="relative overflow-hidden border-b border-[#e2e8f0] bg-[radial-gradient(circle_at_top,_#e6f5f3,_#ffffff_60%)] py-16">
        <MarketingHeroBackground />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#0f6f6b]">
              Plantillas
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#0f172a] sm:text-5xl">
              Plantillas reales para tu rubro
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[#475569] sm:text-lg">
              Contenido de ejemplo, editable de inmediato. Elige la que más se acerque a tu negocio y hazla tuya en el
              asistente de bienvenida: colores, textos y botones se personalizan después.
            </p>
          </Reveal>
        </div>
      </section>

      {templates.length > 0 ? (
        <section id="galeria" aria-labelledby="galeria-titulo" className="mx-auto flex max-w-6xl scroll-mt-24 flex-col gap-8 px-4 py-20 sm:px-6">
          <div className="flex flex-col gap-2">
            <h2 id="galeria-titulo" className="text-2xl font-semibold tracking-tight text-[#0f172a] sm:text-3xl">
              Galería de plantillas
            </h2>
            <p className="max-w-2xl text-sm text-[#475569] sm:text-base">
              Filtra por rubro o por si la plantilla trae botón de suscripción para tu comunidad. Abre cualquiera para ver sus tres
              páginas por dentro.
            </p>
          </div>
          <TemplateGalleryFilters query={query} industries={industriesInCatalog(templates)} total={results.total} />
          {results.total > 0 ? (
            <>
              <ul className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3" aria-label={`Plantillas, página ${results.page} de ${results.totalPages}`}>
                {results.items.map((template, position) => (
                  <li key={template.code}>
                    <TemplateGalleryCard template={template} index={(results.page - 1) * TEMPLATES_PER_PAGE + position + 1} useHref={getTemplateLinks(template.code).useHref} />
                  </li>
                ))}
              </ul>
              <GalleryPagination query={query} page={results.page} totalPages={results.totalPages} />
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[#cbd5e1] px-6 py-16 text-center">
              <p className="text-base font-medium text-[#0f172a]">Ninguna plantilla coincide con esos filtros.</p>
              <Link href="/plantillas#galeria" className="rounded-[10px] border border-[#cbd5e1] px-4 py-2.5 text-sm font-semibold text-[#0f172a] hover:bg-[#f1f5f9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f6f6b]">
                Ver todas las plantillas
              </Link>
            </div>
          )}
        </section>
      ) : (
        <section className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
          <p className="text-sm text-[#64748b]">Todavía no hay plantillas publicadas en el catálogo.</p>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <Reveal>
          <div className="relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl bg-[#0f172a] px-6 py-16 text-center">
            <MarketingCtaBackground />
            <h2 className="relative max-w-xl text-3xl font-semibold tracking-tight text-white">
              ¿Ninguna plantilla calza exacto? Igual puedes empezar y editarla toda.
            </h2>
            <a
              href={registroHref}
              className="relative rounded-[10px] bg-[#0f6f6b] px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Crear mi portal gratis
            </a>
          </div>
        </Reveal>
      </section>

      <MarketingFooter registroHref={registroHref} loginHref={loginHref} />
    </div>
  );
}
