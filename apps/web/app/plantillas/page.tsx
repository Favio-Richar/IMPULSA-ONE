import { MarketingHeader } from "../../components/marketing/header";
import { MarketingHeroBackground, MarketingCtaBackground } from "../../components/marketing/hero-background";
import { MarketingFooter } from "../../components/marketing/footer";
import { Reveal } from "../../components/marketing/reveal";
import { TemplateMockup } from "../../components/marketing/shared";
import { getDashboardLinks } from "../../lib/dashboard-links";
import { getTemplateCatalog } from "../../lib/api";

export const metadata = {
  title: "Plantillas — Impulza One",
  description: "Elegí una plantilla real del catálogo de Impulza One, filtrada por rubro, y hacela tuya en el asistente de bienvenida.",
};

export default async function PlantillasPage() {
  const templates = await getTemplateCatalog();
  const { bienvenidaHref, loginHref } = getDashboardLinks();

  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <MarketingHeader bienvenidaHref={bienvenidaHref} loginHref={loginHref} />

      <section className="relative overflow-hidden border-b border-[#e2e8f0] bg-[radial-gradient(circle_at_top,_#eef2ff,_#ffffff_60%)] py-20">
        <MarketingHeroBackground />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#4338ca]">
              Plantillas
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#0f172a] sm:text-5xl">
              Plantillas reales para tu rubro
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[#475569] sm:text-lg">
              Contenido de ejemplo, editable de inmediato. Elegí la que más se acerque a tu negocio y hacela tuya en el
              asistente de bienvenida — colores, textos y botones se personalizan después.
            </p>
          </Reveal>
        </div>
      </section>

      {templates.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template, index) => (
              <Reveal key={template.code} delayMs={index * 60}>
                <a href={bienvenidaHref} className="block">
                  <TemplateMockup template={template} />
                </a>
              </Reveal>
            ))}
          </div>
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
              ¿Ninguna plantilla calza exacto? Igual podés empezar y editarla toda.
            </h2>
            <a
              href={bienvenidaHref}
              className="relative rounded-[10px] bg-[#4338ca] px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Crear mi portal gratis
            </a>
          </div>
        </Reveal>
      </section>

      <MarketingFooter bienvenidaHref={bienvenidaHref} loginHref={loginHref} />
    </div>
  );
}
