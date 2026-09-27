import type { PlanResponse } from "@impulza/contracts";
import { MarketingHeader } from "../../components/marketing/header";
import { MarketingHeroBackground, MarketingCtaBackground } from "../../components/marketing/hero-background";
import { MarketingFooter } from "../../components/marketing/footer";
import { Reveal } from "../../components/marketing/reveal";
import { PlanCard, ComparisonTable, FaqAccordion, FAQ_ITEMS } from "../../components/marketing/shared";
import { getDashboardLinks } from "../../lib/dashboard-links";
import { getPlanCatalog } from "../../lib/api";

export const metadata = {
  title: "Planes — Impulza One",
  description: "Planes simples y sin sorpresas para tu portal biográfico, mini-CRM, formularios, QR y analítica.",
};

export default async function PlanesPage() {
  const plansRaw = await getPlanCatalog();
  const { bienvenidaHref, loginHref } = getDashboardLinks();
  const plans: PlanResponse[] = [...plansRaw].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <MarketingHeader bienvenidaHref={bienvenidaHref} loginHref={loginHref} />

      <section className="relative overflow-hidden border-b border-[#e2e8f0] bg-[radial-gradient(circle_at_top,_#e6f5f3,_#ffffff_60%)] py-20">
        <MarketingHeroBackground />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#0f6f6b]">
              Planes
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#0f172a] sm:text-5xl">
              Planes simples, sin sorpresas
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[#475569] sm:text-lg">
              Empezá gratis y subí de plan solo cuando lo necesites. Sin contratos forzados, sin costos ocultos.
            </p>
          </Reveal>
        </div>
      </section>

      {plans.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan, index) => {
              const isRecommended = index === 1 && plans.length > 2;
              return (
                <Reveal key={plan.code} delayMs={index * 80}>
                  <PlanCard plan={plan} isRecommended={isRecommended} bienvenidaHref={bienvenidaHref} />
                </Reveal>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="border-y border-[#e2e8f0] bg-[#f8fafc] py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-[#0f172a]">Por qué elegir Impulza One</h2>
            <p className="mt-3 text-[#475569]">
              Las plataformas de enlace en bio tradicionales resuelven una sola parte. Impulza One suma lo demás sin
              que tengas que contratar otra herramienta aparte.
            </p>
          </Reveal>

          <Reveal>
            <div className="mt-10">
              <ComparisonTable />
            </div>
            <p className="mt-3 text-xs text-[#94a3b8]">
              Comparación referencial sobre funcionalidades típicas del rubro de enlace en bio; cada plataforma varía
              según su plan.
            </p>
          </Reveal>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <Reveal className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-[#0f172a]">Preguntas frecuentes</h2>
        </Reveal>

        <div className="mt-10">
          <FaqAccordion items={FAQ_ITEMS} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <Reveal>
          <div className="relative flex flex-col items-center gap-6 overflow-hidden rounded-3xl bg-[#0f172a] px-6 py-16 text-center">
            <MarketingCtaBackground />
            <h2 className="relative max-w-xl text-3xl font-semibold tracking-tight text-white">
              Tu identidad digital, lista para el mercado.
            </h2>
            <a
              href={bienvenidaHref}
              className="relative rounded-[10px] bg-[#0f6f6b] px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
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
