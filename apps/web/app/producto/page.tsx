import { MarketingHeader } from "../../components/marketing/header";
import { MarketingFooter } from "../../components/marketing/footer";
import { Reveal } from "../../components/marketing/reveal";
import { FEATURES, FeatureIcon, STEPS } from "../../components/marketing/shared";
import { getDashboardLinks } from "../../lib/dashboard-links";

export const metadata = {
  title: "Producto — Impulza One",
  description:
    "Portal biográfico, mini-CRM, formularios propios, QR y analítica real: todo lo que trae Impulza One para tu enlace en bio.",
};

const DEEP_DIVES = [
  {
    title: "Portal biográfico moderno",
    body: "Armá tu página de enlaces con el mismo estilo que ya conocen tus visitantes de Linktree, Beacons o Stan: foto de perfil, bio, botones destacados y hasta varias páginas dentro del mismo portal si tu plan lo permite.",
  },
  {
    title: "Mini-CRM incluido",
    body: "Cada visitante que te deja un dato queda como contacto: con etiquetas, notas y el enlace o formulario por el que llegó. No hace falta contratar un CRM aparte para tu enlace en bio.",
  },
  {
    title: "Formularios propios",
    body: "Construí formularios con los campos que necesites — reservas, cotizaciones, postulaciones — sin depender de un link externo a otro servicio ni de plantillas genéricas.",
  },
  {
    title: "QR y enlaces cortos con métricas propias",
    body: "Cada botón de tu portal puede tener su propio QR o enlace corto, con sus propias métricas de escaneos y clics, listos para imprimir o compartir por separado.",
  },
  {
    title: "Analítica real",
    body: "Visitas, clics por botón, leads generados y conversión — por sitio individual o de toda la cuenta — sin conectar Google Analytics ni ninguna otra herramienta.",
  },
  {
    title: "Multi-sitio y equipos",
    body: "Pensado también para agencias: varias organizaciones, varios sitios por organización, y roles y permisos distintos por integrante del equipo.",
  },
];

export default async function ProductoPage() {
  const { bienvenidaHref, loginHref } = getDashboardLinks();

  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <MarketingHeader bienvenidaHref={bienvenidaHref} loginHref={loginHref} />

      <section className="border-b border-[#e2e8f0] bg-[radial-gradient(circle_at_top,_#eef2ff,_#ffffff_60%)] py-20">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-white px-3 py-1 text-xs font-medium text-[#4338ca]">
              Producto
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#0f172a] sm:text-5xl">
              Todo lo que necesita tu identidad digital, en un solo sistema
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-[#475569] sm:text-lg">
              Impulza One une lo que las apps de enlace en bio hacen bien con lo que normalmente falta: mini-CRM,
              formularios propios, QR nativo y analítica real — sin sumar otra herramienta ni otra suscripción.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delayMs={index * 60}>
              <div className="flex h-full flex-col gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#eef2ff] text-[#4338ca]">
                  <FeatureIcon name={feature.icon} />
                </span>
                <h2 className="text-base font-semibold text-[#0f172a]">{feature.title}</h2>
                <p className="text-sm text-[#64748b]">{feature.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y border-[#e2e8f0] bg-[#f8fafc] py-20">
        <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 sm:px-6">
          {DEEP_DIVES.map((item, index) => (
            <Reveal key={item.title} delayMs={index * 50}>
              <div className="flex flex-col gap-2 rounded-2xl border border-[#e2e8f0] bg-white p-6 sm:p-8">
                <h2 className="text-lg font-semibold text-[#0f172a]">{item.title}</h2>
                <p className="text-sm text-[#475569] sm:text-base">{item.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
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
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <Reveal>
          <div className="flex flex-col items-center gap-6 rounded-3xl bg-[#0f172a] px-6 py-16 text-center">
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-white">
              Probá Impulza One con tu propio contenido.
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
