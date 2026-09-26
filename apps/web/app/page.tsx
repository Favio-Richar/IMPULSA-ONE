import Link from "next/link";
import type { PlanResponse } from "@impulza/contracts";
import { getPlanCatalog, getTemplateCatalog } from "../lib/api";
import { getDashboardLinks } from "../lib/dashboard-links";
import { MarketingHeader } from "../components/marketing/header";
import { MarketingFooter } from "../components/marketing/footer";
import { Reveal } from "../components/marketing/reveal";
import { TemplateAvatar } from "../components/marketing/template-avatar";
import { FEATURES, FeatureIcon, STEPS, PlanCard, TemplateMockup } from "../components/marketing/shared";

export default async function MarketingHomePage() {
  const [templates, plansRaw] = await Promise.all([getTemplateCatalog(), getPlanCatalog()]);
  const { bienvenidaHref, loginHref } = getDashboardLinks();
  const featuredTemplates = templates.slice(0, 3);
  const plans: PlanResponse[] = [...plansRaw].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <MarketingHeader bienvenidaHref={bienvenidaHref} loginHref={loginHref} />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[#e2e8f0] bg-[radial-gradient(circle_at_top,_#eef2ff,_#ffffff_60%)]">
        <div
          aria-hidden="true"
          className="animate-marketing-float pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#c7d2fe] opacity-40 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="animate-marketing-float pointer-events-none absolute -right-16 top-32 h-64 w-64 rounded-full bg-[#ddd6fe] opacity-40 blur-3xl [animation-delay:-3s]"
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 md:grid-cols-2 md:py-28">
          <Reveal className="flex flex-col justify-center gap-6">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#4338ca]">
              Identidad digital todo en uno
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-[#0f172a] sm:text-5xl">
              Tu portal biográfico, tu mini-CRM y tu analítica — en un solo enlace.
            </h1>
            <p className="max-w-lg text-base text-[#475569] sm:text-lg">
              Impulza One arma tu página de enlace en bio con el estilo que tus visitantes ya conocen, y suma lo que
              Linktree, Beacons y Stan no traen juntos: formularios propios, mini-CRM, QR nativo y analítica real.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href={bienvenidaHref}
                className="rounded-[10px] bg-[#4338ca] px-6 py-3.5 text-center text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Crear mi portal gratis
              </a>
              <Link
                href="/plantillas"
                className="rounded-[10px] border border-[#e2e8f0] px-6 py-3.5 text-center text-base font-semibold text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
              >
                Ver plantillas
              </Link>
            </div>
            <p className="text-sm text-[#64748b]">Sin tarjeta de crédito. Publicás en minutos.</p>
          </Reveal>

          <Reveal delayMs={150} className="flex items-center justify-center">
            <div className="animate-marketing-float w-64 rounded-[2rem] border-8 border-[#0f172a] bg-[#0f172a] p-2 shadow-xl [animation-delay:-1.5s]">
              <div className="flex flex-col items-center gap-3 rounded-[1.4rem] bg-[#111827] px-4 py-8 text-center">
                <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[#4338ca] text-lg font-semibold text-white">
                  <TemplateAvatar src="https://api.dicebear.com/9.x/notionists/svg?seed=impulza-one-demo&backgroundColor=transparent" fallbackLabel="TU" />
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-white">Tu negocio</span>
                  <span className="text-xs text-[#94a3b8]">Texto de ejemplo: tu bio va acá</span>
                </div>
                <div className="mt-2 flex w-full flex-col gap-2">
                  <span className="h-9 w-full rounded-[10px] bg-[#4338ca]" />
                  <span className="h-9 w-full rounded-[10px] border border-white/20 bg-white/10" />
                  <span className="h-9 w-full rounded-[10px] border border-white/20 bg-white/10" />
                </div>
                <div className="mt-2 flex gap-2">
                  {[0, 1, 2].map((index) => (
                    <span key={index} className="h-7 w-7 rounded-full border border-white/20 bg-white/10" />
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-[#0f172a]">Todo lo que necesitás, en un solo lugar</h2>
          <p className="mt-3 text-[#475569]">
            Nada de armar tu presencia digital con cinco herramientas distintas que no se hablan entre sí.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delayMs={index * 80}>
              <div className="flex h-full flex-col gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#eef2ff] text-[#4338ca]">
                  <FeatureIcon name={feature.icon} />
                </span>
                <h3 className="text-base font-semibold text-[#0f172a]">{feature.title}</h3>
                <p className="text-sm text-[#64748b]">{feature.description}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-10 text-center">
          <Link href="/producto" className="text-sm font-semibold text-[#4338ca] hover:underline">
            Ver todas las funcionalidades →
          </Link>
        </Reveal>
      </section>

      {/* Cómo funciona */}
      <section className="border-y border-[#e2e8f0] bg-[#f8fafc] py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-[#0f172a]">Publicás tu portal en tres pasos</h2>
          </Reveal>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <Reveal key={step.title} delayMs={index * 100}>
                <div className="flex flex-col gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-6">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#4338ca] text-sm font-semibold text-white">
                    {index + 1}
                  </span>
                  <h3 className="text-base font-semibold text-[#0f172a]">{step.title}</h3>
                  <p className="text-sm text-[#64748b]">{step.description}</p>
                </div>
              </Reveal>
          ))}
        </div>
      </div>
      </section>

      {/* Plantillas */}
      {featuredTemplates.length > 0 ? (
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-[#0f172a]">Plantillas para tu rubro</h2>
            <p className="mt-3 text-[#475569]">
              Contenido de ejemplo, editable de inmediato — elegí una y hacela tuya en el asistente.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featuredTemplates.map((template, index) => (
              <Reveal key={template.code} delayMs={index * 70}>
                <a href={bienvenidaHref} className="block">
                  <TemplateMockup template={template} />
                </a>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-10 text-center">
            <Link href="/plantillas" className="text-sm font-semibold text-[#4338ca] hover:underline">
              Ver todas las plantillas →
            </Link>
          </Reveal>
        </section>
      ) : null}

      {/* Planes */}
      {plans.length > 0 ? (
        <section className="border-t border-[#e2e8f0] bg-[#f8fafc] py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-[#0f172a]">Planes simples, sin sorpresas</h2>
            </Reveal>

            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {plans.map((plan, index) => {
                const isRecommended = index === 1 && plans.length > 2;
                return (
                  <Reveal key={plan.code} delayMs={index * 80}>
                    <PlanCard plan={plan} isRecommended={isRecommended} bienvenidaHref={bienvenidaHref} />
                  </Reveal>
                );
              })}
            </div>

            <Reveal className="mt-10 text-center">
              <Link href="/planes" className="text-sm font-semibold text-[#4338ca] hover:underline">
                Ver comparativa completa y preguntas frecuentes →
              </Link>
            </Reveal>
          </div>
        </section>
      ) : null}

      {/* CTA final */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <Reveal>
          <div className="flex flex-col items-center gap-6 rounded-3xl bg-[#0f172a] px-6 py-16 text-center">
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-white">
              Tu identidad digital, lista para el mercado.
            </h2>
            <a
              href={bienvenidaHref}
              className="rounded-[10px] bg-[#4338ca] px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
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
