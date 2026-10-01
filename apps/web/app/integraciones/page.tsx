import Link from "next/link";
import { MarketingFooter } from "../../components/marketing/footer";
import { MarketingHeader } from "../../components/marketing/header";
import { MarketingHeroBackground, MarketingCtaBackground } from "../../components/marketing/hero-background";
import { IntegracionesDirectory } from "../../components/marketing/integraciones-directory";
import { Reveal } from "../../components/marketing/reveal";
import { getDashboardLinks } from "../../lib/dashboard-links";

export const metadata = {
  title: "Integraciones — Impulza One",
  description:
    "Conecta Impulza One con pasarelas de pago, calendarios universales, webhooks y herramientas de marketing: Webpay, Mercado Pago, Google Calendar, Zapier, GA4 y más.",
};

export default function IntegracionesPage(): React.JSX.Element {
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
              Ecosistema e integraciones
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#0f172a] sm:text-5xl">
              Conecta tu portal con tus herramientas de trabajo
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[#475569] sm:text-lg">
              Impulza One se integra de forma transparente con pasarelas de pago chilenas, calendarios en tiempo real,
              plataformas de automatización no-code y herramientas de analítica con consentimiento.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Catálogo de integraciones */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <IntegracionesDirectory bienvenidaHref={bienvenidaHref} />
      </section>

      {/* CTA Final */}
      <section className="relative overflow-hidden border-t border-[#e2e8f0] bg-[radial-gradient(circle_at_bottom,_#e6f5f3,_#ffffff_70%)] py-20">
        <MarketingCtaBackground />
        <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight text-[#0f172a] sm:text-4xl">
              ¿Listo para automatizar la presencia de tu negocio?
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[#475569]">
              Crea tu portal en minutos, conecta tus herramientas favoritas y comienza a recibir pagos, reservas y
              prospectos desde un solo lugar.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href={bienvenidaHref}
                className="rounded-[10px] bg-[#0f6f6b] px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                Empezar gratis
              </a>
              <Link
                href="/planes"
                className="rounded-[10px] border border-[#e2e8f0] bg-white px-6 py-3 text-sm font-semibold text-[#0f172a] transition hover:bg-slate-50"
              >
                Ver planes y límites
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <MarketingFooter bienvenidaHref={bienvenidaHref} loginHref={loginHref} />
    </div>
  );
}
