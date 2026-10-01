import Link from "next/link";
import { MarketingFooter } from "../../components/marketing/footer";
import { MarketingHeader } from "../../components/marketing/header";
import { MarketingHeroBackground, MarketingCtaBackground } from "../../components/marketing/hero-background";
import { Reveal } from "../../components/marketing/reveal";
import { getDashboardLinks } from "../../lib/dashboard-links";
import { SOLUCIONES_RUBROS } from "../../lib/marketing/soluciones";

export const metadata = {
  title: "Soluciones por Rubro — Impulza One",
  description:
    "Descubre cómo Impulza One se adapta a tu negocio: salud, gastronomía, creadores, e-commerce, consultorías y talleres con reservas, catálogo y mini-CRM.",
};

export default function SolucionesPage(): React.JSX.Element {
  const { bienvenidaHref, loginHref } = getDashboardLinks();

  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <MarketingHeader bienvenidaHref={bienvenidaHref} loginHref={loginHref} />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[#e2e8f0] bg-[radial-gradient(circle_at_top,_#e6f5f3,_#ffffff_60%)] py-20">
        <MarketingHeroBackground />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#0f6f6b]">
              Soluciones por industria
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#0f172a] sm:text-5xl">
              Diseñado a la medida de tu rubro comercial
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[#475569] sm:text-lg">
              Sea que atiendas pacientes, prepares café, vendas productos físicos o enseñes en línea: Impulza One reúne
              las herramientas exactas que tu negocio necesita para captar y vender.
            </p>
          </Reveal>

          {/* Navegación rápida por rubro */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            {SOLUCIONES_RUBROS.map((rubro) => (
              <a
                key={rubro.id}
                href={`#${rubro.slug}`}
                className="rounded-full border border-[#e2e8f0] bg-white/80 px-3.5 py-1.5 text-xs font-medium text-[#475569] transition hover:border-[#0f6f6b] hover:text-[#0f6f6b]"
              >
                {rubro.nombre}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Lista detallada de rubros */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-col gap-20">
          {SOLUCIONES_RUBROS.map((rubro, index) => (
            <div
              key={rubro.id}
              id={rubro.slug}
              className="scroll-mt-24 rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm transition-shadow hover:shadow-md sm:p-10"
            >
              <Reveal delayMs={index * 40}>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="rounded-md bg-[#e6f5f3] px-3 py-1 text-xs font-semibold text-[#0f6f6b]">
                      {rubro.nombre}
                    </span>
                    <span className="text-xs text-[#64748b]">Solución #{index + 1}</span>
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#0f172a] sm:text-3xl">
                    {rubro.tagline}
                  </h2>
                  <p className="text-sm leading-relaxed text-[#475569] sm:text-base">{rubro.descripcion}</p>
                </div>

                <div className="mt-8 grid gap-8 md:grid-cols-2">
                  {/* Desafíos */}
                  <div className="rounded-xl border border-red-100 bg-red-50/30 p-5">
                    <h3 className="text-sm font-semibold text-red-900">El desafío común</h3>
                    <ul className="mt-3 flex flex-col gap-2 text-xs text-red-800/90 sm:text-sm">
                      {rubro.problemas.map((problema, pIdx) => (
                        <li key={pIdx} className="flex items-start gap-2">
                          <span className="text-red-500 font-bold" aria-hidden="true">✕</span>
                          <span>{problema}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Beneficios con Impulza */}
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-5">
                    <h3 className="text-sm font-semibold text-emerald-900">La solución con Impulza One</h3>
                    <ul className="mt-3 flex flex-col gap-2 text-xs text-emerald-900/90 sm:text-sm">
                      {rubro.beneficios.map((beneficio, bIdx) => (
                        <li key={bIdx} className="flex items-start gap-2">
                          <span className="text-[#0f6f6b] font-bold" aria-hidden="true">✓</span>
                          <span>{beneficio}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Bloques recomendados y plantilla */}
                <div className="mt-8 grid gap-6 md:grid-cols-3">
                  <div className="md:col-span-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-5">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748b]">
                      Bloques y funciones clave recomendadas
                    </h4>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      {rubro.bloquesRecomendados.map((bloque, bIdx) => (
                        <div key={bIdx} className="rounded-lg bg-white p-3 border border-[#e2e8f0]">
                          <span className="block text-xs font-medium text-[#0f172a]">{bloque.nombre}</span>
                          <span className="mt-1 block text-[11px] text-[#64748b] leading-snug">{bloque.motivo}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col justify-between rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-5">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748b]">
                        Plantilla recomendada
                      </h4>
                      <p className="mt-2 text-sm font-medium text-[#0f172a]">{rubro.plantillaRecomendada.nombre}</p>
                      <p className="mt-1 text-xs text-[#64748b]">{rubro.plantillaRecomendada.descripcion}</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#e2e8f0] pt-3">
                      <Link
                        href="/plantillas"
                        className="text-xs font-medium text-[#0f6f6b] hover:underline"
                      >
                        Ver plantilla →
                      </Link>
                      <a
                        href={bienvenidaHref}
                        className="rounded-md bg-[#0f6f6b] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
                      >
                        Empezar
                      </a>
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Final */}
      <section className="relative overflow-hidden border-t border-[#e2e8f0] bg-[radial-gradient(circle_at_bottom,_#e6f5f3,_#ffffff_70%)] py-20">
        <MarketingCtaBackground />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight text-[#0f172a] sm:text-4xl">
              ¿No ves tu rubro específico en la lista?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[#475569]">
              Impulza One es modular y flexible: puedes combinar bloques de reservas, ventas, formularios y contenido
              para cualquier tipo de proyecto o negocio digital.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href={bienvenidaHref}
                className="rounded-[10px] bg-[#0f6f6b] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                Crear mi portal gratis
              </a>
              <Link
                href="/producto"
                className="rounded-[10px] border border-[#e2e8f0] bg-white px-6 py-3 text-sm font-semibold text-[#0f172a] transition hover:bg-slate-50"
              >
                Conocer todas las funciones
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <MarketingFooter bienvenidaHref={bienvenidaHref} loginHref={loginHref} />
    </div>
  );
}
