import { MarketingFooter } from "../../components/marketing/footer";
import { BrandedMarketingHeader } from "../../components/marketing/branded-header";
import { getDashboardLinks } from "../../lib/dashboard-links";
import { FECHA_VIGENCIA_PRIVACIDAD, SECCIONES_PRIVACIDAD } from "../../lib/marketing/privacidad";

export const metadata = {
  title: "Política de Privacidad — Impulza One",
  description:
    "Política de Privacidad y protección de datos personales de Impulza One conforme a la Ley 19.628 y Ley 21.719 en Chile: finalidades, rol de encargado, seguridad y derechos ARCO.",
};

export default function PrivacidadPage(): React.JSX.Element {
  const { bienvenidaHref, loginHref } = getDashboardLinks();

  return (
    <div className="min-h-screen bg-white text-[#0f172a]">
      <BrandedMarketingHeader bienvenidaHref={bienvenidaHref} loginHref={loginHref} />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl text-[#0f172a]">
          Política de Privacidad
        </h1>
        <p className="mt-3 text-sm text-[#475569]">
          Vigente desde el {FECHA_VIGENCIA_PRIVACIDAD}. Conforme a la legislación de la República de Chile (Ley 19.628 y Ley 21.719).
        </p>

        {/* Índice interactivo de secciones */}
        <nav aria-label="Secciones de la política" className="mt-8 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#64748b]">
            Contenido del documento
          </p>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {SECCIONES_PRIVACIDAD.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-[#0f6f6b] underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-[#0f6f6b]"
                >
                  {section.titulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Artículos y cláusulas de privacidad */}
        <div className="mt-10 flex flex-col gap-10">
          {SECCIONES_PRIVACIDAD.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-titulo`}
              className="scroll-mt-24"
            >
              <h2 id={`${section.id}-titulo`} className="text-xl font-semibold text-[#0f172a]">
                {section.titulo}
              </h2>
              {section.parrafos.map((parrafo, pIdx) => (
                <p key={pIdx} className="mt-3 leading-relaxed text-[#334155]">
                  {parrafo}
                </p>
              ))}
              {section.destacados && section.destacados.length > 0 && (
                <ul className="mt-4 flex flex-col gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-4 text-sm text-[#334155]">
                  {section.destacados.map((item, dIdx) => (
                    <li key={dIdx} className="flex items-start gap-2">
                      <span className="text-[#0f6f6b] font-bold" aria-hidden="true">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </main>
      <MarketingFooter bienvenidaHref={bienvenidaHref} loginHref={loginHref} />
    </div>
  );
}
