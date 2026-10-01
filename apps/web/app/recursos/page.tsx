import Link from "next/link";
import { MarketingFooter } from "../../components/marketing/footer";
import { MarketingHeader } from "../../components/marketing/header";
import { MarketingHeroBackground, MarketingCtaBackground } from "../../components/marketing/hero-background";
import { Reveal } from "../../components/marketing/reveal";
import { getDashboardLinks } from "../../lib/dashboard-links";
import { HERRAMIENTAS_UTILES, RECURSOS_GUIAS } from "../../lib/marketing/recursos";

export const metadata = {
  title: "Recursos y Guías — Impulza One",
  description:
    "Aprende a potenciar tu centro digital con nuestras guías de inicio rápido, buenas prácticas de reservas, cobros online, privacidad Ley 21.719 y optimización de conversión.",
};

export default function RecursosPage(): React.JSX.Element {
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
              Centro de conocimiento
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#0f172a] sm:text-5xl">
              Recursos y guías para hacer crecer tu negocio
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[#475569] sm:text-lg">
              Tutoriales paso a paso, buenas prácticas de conversión y recomendaciones normativas para sacarle el máximo
              partido a tu portal de Impulza One.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Guías y Artículos */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Guías esenciales de negocio</h2>
          <p className="text-sm text-[#64748b]">
            Artículos detallados preparados por nuestro equipo para ayudarte a configurar, vender y cumplir las normas.
          </p>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {RECURSOS_GUIAS.map((guia) => (
            <article
              key={guia.id}
              className="flex flex-col justify-between rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-[#64748b]">
                  <span className="rounded bg-[#e6f5f3] px-2.5 py-0.5 font-medium text-[#0f6f6b]">
                    {guia.categoria}
                  </span>
                  <span>{guia.tiempoLectura}</span>
                </div>
                <h3 className="mt-3 text-base font-semibold text-[#0f172a] leading-snug">{guia.titulo}</h3>
                <p className="mt-2 text-xs leading-relaxed text-[#64748b]">{guia.resumen}</p>

                <div className="mt-4 border-t border-[#e2e8f0] pt-3">
                  <span className="text-[11px] font-semibold text-[#0f172a]">Lo que aprenderás:</span>
                  <ul className="mt-2 flex flex-col gap-1 text-[11px] text-[#475569]">
                    {guia.puntosClave.map((punto, pIdx) => (
                      <li key={pIdx} className="flex items-start gap-1.5">
                        <span className="text-[#0f6f6b] font-bold">•</span>
                        <span>{punto}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-6 border-t border-[#e2e8f0] pt-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0f6f6b]">Disponible en la plataforma</span>
                <a href={bienvenidaHref} className="text-xs font-medium text-[#0f6f6b] hover:underline">
                  Aplicar ahora →
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Herramientas y utilidades */}
      <section className="border-t border-[#e2e8f0] bg-[#f8fafc] py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-2 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-[#0f172a]">Herramientas y accesos rápidos</h2>
            <p className="mx-auto max-w-xl text-sm text-[#64748b]">
              Explora recursos interactivos y secciones clave de la plataforma para poner en marcha tu estrategia digital.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {HERRAMIENTAS_UTILES.map((herramienta, idx) => (
              <div
                key={idx}
                className="flex flex-col justify-between rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm"
              >
                <div>
                  <h3 className="text-base font-semibold text-[#0f172a]">{herramienta.titulo}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#64748b]">{herramienta.descripcion}</p>
                </div>
                <div className="mt-6 border-t border-[#e2e8f0] pt-4">
                  <Link
                    href={herramienta.enlace}
                    className="text-xs font-semibold text-[#0f6f6b] hover:underline"
                  >
                    {herramienta.label} →
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Banner de soporte y estado */}
          <div className="mt-12 rounded-2xl border border-[#e2e8f0] bg-white p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 shadow-sm">
            <div>
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Soporte en español
              </span>
              <h3 className="mt-2 text-lg font-semibold text-[#0f172a]">¿Necesitas ayuda con tu cuenta?</h3>
              <p className="mt-1 text-xs text-[#64748b] max-w-lg">
                Nuestro equipo de atención técnica y comercial está disponible para ayudarte a configurar tus cobros,
                vincular tu dominio o resolver cualquier duda sobre tu suscripción.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <a
                href={loginHref}
                className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-xs font-semibold text-[#0f172a] hover:bg-slate-50"
              >
                Ir a Soporte
              </a>
              <a
                href={bienvenidaHref}
                className="rounded-lg bg-[#0f6f6b] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90"
              >
                Crear cuenta
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Final */}
      <section className="relative overflow-hidden border-t border-[#e2e8f0] bg-white py-16">
        <MarketingCtaBackground />
        <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight text-[#0f172a]">
              Comienza hoy mismo con tu propio centro digital
            </h2>
            <p className="mt-3 text-sm text-[#475569]">
              Sin contratos de permanencia, sin comisiones sobre tus ventas y con un plan gratuito disponible para siempre.
            </p>
            <div className="mt-6 flex justify-center">
              <a
                href={bienvenidaHref}
                className="rounded-[10px] bg-[#0f6f6b] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                Crear mi portal gratis
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      <MarketingFooter bienvenidaHref={bienvenidaHref} loginHref={loginHref} />
    </div>
  );
}
