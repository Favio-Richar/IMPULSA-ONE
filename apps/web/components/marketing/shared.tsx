import type { PlanResponse, TemplateResponse } from "@impulza/contracts";
import { TemplateThumbnail } from "./template-thumbnail";

export type ReactIcon = "link" | "users" | "chart" | "qr" | "form" | "grid";

export const FEATURES: Array<{ title: string; description: string; icon: ReactIcon }> = [
  {
    title: "Portal biográfico moderno",
    description:
      "Un solo enlace con tu perfil, tus redes y todos tus botones — con el look de las apps de enlace en bio que tus visitantes ya conocen.",
    icon: "link",
  },
  {
    title: "Mini-CRM incluido",
    description: "Cada formulario y contacto que llega a tu portal queda organizado, con etiquetas y notas — sin otra herramienta.",
    icon: "users",
  },
  {
    title: "Analítica real",
    description: "Visitas, clics por botón, leads y conversión, por sitio o de toda tu cuenta, sin configurar nada aparte.",
    icon: "chart",
  },
  {
    title: "QR y enlaces cortos",
    description: "Un QR o un link corto para cada botón, listo para imprimir o compartir, con sus propias métricas.",
    icon: "qr",
  },
  {
    title: "Formularios propios",
    description: "Constructor de formularios con campos a medida, sin depender de un enlace externo a otro servicio.",
    icon: "form",
  },
  {
    title: "Multi-sitio y equipos",
    description: "Varias organizaciones, varios sitios, roles y permisos por integrante — pensado para agencias también.",
    icon: "grid",
  },
];

export const STEPS = [
  {
    title: "Contá quién eres",
    description: "Once pasos guiados: tipo de cuenta, objetivo, rubro, redes y enlaces que ya usas.",
  },
  {
    title: "Elegí tu plantilla",
    description: "Una de las plantillas reales del catálogo, filtrada por tu rubro y objetivo — editable de inmediato.",
  },
  {
    title: "Publicá y compartí",
    description: "Tu portal queda en vivo con su propio enlace, QR y analítica desde el primer minuto.",
  },
];

export function FeatureIcon({ name }: { name: ReactIcon }) {
  const paths: Record<ReactIcon, string> = {
    link: "M9 15l6-6M10 6l1.5-1.5a3.5 3.5 0 015 5L15 11M14 18l-1.5 1.5a3.5 3.5 0 01-5-5L9 13",
    users: "M17 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M15 4a4 4 0 010 8M13 8a4 4 0 11-8 0 4 4 0 018 0z",
    chart: "M4 20V10M12 20V4M20 20v-7",
    qr: "M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 3h6m-6 3h3m0-6v6",
    form: "M6 4h9l3 3v13H6V4zM9 12h6M9 16h6M9 8h3",
    grid: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
  };
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

export function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

export function TemplateMockup({ template }: { template: TemplateResponse }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm transition-transform duration-300 group-hover:-translate-y-1 group-hover:shadow-md group-focus-within:-translate-y-1">
      <TemplateThumbnail template={template} />
      <div className="flex flex-1 flex-col gap-1 border-t border-[#e2e8f0] px-5 py-4">
        <span className="text-sm font-semibold text-[#0f172a]">{template.name}</span>
        <span className="text-xs text-[#64748b]">{template.description}</span>
      </div>
    </div>
  );
}

/**
 * Tarjeta de plantilla que lleva al asistente. El enlace va superpuesto y no envolviendo la
 * miniatura: la miniatura pinta los bloques reales de la plantilla, que traen sus propios `<a>`, y
 * un enlace dentro de otro es HTML inválido (el navegador lo parte y React falla al hidratar).
 */
export function TemplateCardLink({ template, href, className = "" }: { template: TemplateResponse; href: string; className?: string }) {
  return (
    <div className={`group relative ${className}`} data-carousel-card>
      <TemplateMockup template={template} />
      <a
        href={href}
        aria-label={`Usar la plantilla ${template.name}`}
        className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2"
      />
    </div>
  );
}

export function PlanCard({
  plan,
  isRecommended,
  bienvenidaHref,
}: {
  plan: PlanResponse;
  isRecommended: boolean;
  bienvenidaHref: string;
}) {
  return (
    <div
      className={`relative flex h-full flex-col gap-4 rounded-2xl border bg-white p-6 shadow-sm transition-transform duration-300 ${
        isRecommended ? "border-2 border-[#0f6f6b] shadow-md md:-translate-y-2" : "border-[#e2e8f0]"
      }`}
    >
      {isRecommended ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#0f6f6b] px-3 py-1 text-xs font-semibold text-white shadow-sm">
          Recomendado
        </span>
      ) : null}
      <h3 className="text-base font-semibold text-[#0f172a]">{plan.name}</h3>
      <p className="text-3xl font-semibold text-[#0f172a]">
        {plan.priceMonthly === 0 ? "Gratis" : formatPrice(plan.priceMonthly, plan.currency)}
        {plan.priceMonthly > 0 ? <span className="text-sm font-normal text-[#64748b]"> /mes</span> : null}
      </p>
      <ul className="flex flex-1 flex-col gap-2 text-sm text-[#475569]">
        <li>{plan.limits.sites === null ? "Sitios ilimitados" : `${plan.limits.sites} sitio(s)`}</li>
        <li>{plan.limits.pagesPerSite === null ? "Páginas ilimitadas" : `${plan.limits.pagesPerSite} páginas por sitio`}</li>
        <li>{plan.limits.members === null ? "Equipo ilimitado" : `${plan.limits.members} integrante(s)`}</li>
      </ul>
      <a
        href={bienvenidaHref}
        className={
          isRecommended
            ? "rounded-[10px] bg-[#0f6f6b] px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            : "rounded-[10px] border border-[#0f6f6b] px-4 py-2.5 text-center text-sm font-semibold text-[#0f6f6b] transition-colors hover:bg-[#e6f5f3]"
        }
      >
        Elegir {plan.name}
      </a>
    </div>
  );
}

export const COMPARISON_ROWS: Array<{ label: string; ours: boolean; theirs: boolean }> = [
  { label: "Portal biográfico con botones de enlaces", ours: true, theirs: true },
  { label: "Mini-CRM de contactos y leads", ours: true, theirs: false },
  { label: "Formularios propios sin depender de otro servicio", ours: true, theirs: false },
  { label: "QR y enlaces cortos con métricas propias", ours: true, theirs: false },
  { label: "Multi-sitio y roles por integrante (uso en agencia)", ours: true, theirs: false },
];

export function ComparisonTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white shadow-sm">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] text-[#0f172a]">
            <th scope="col" className="px-5 py-3 font-semibold">
              Funcionalidad
            </th>
            <th scope="col" className="px-5 py-3 font-semibold text-[#0f6f6b]">
              Impulza One
            </th>
            <th scope="col" className="px-5 py-3 font-semibold text-[#64748b]">
              Plataformas tradicionales
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e2e8f0]">
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.label}>
              <td className="px-5 py-3 text-[#334155]">{row.label}</td>
              <td className="px-5 py-3">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#e6f5f3] text-[#0f6f6b]" aria-hidden="true">
                  &#10003;
                </span>
                <span className="sr-only">Incluido</span>
              </td>
              <td className="px-5 py-3">
                {row.theirs ? (
                  <>
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#f1f5f9] text-[#64748b]" aria-hidden="true">
                      &#10003;
                    </span>
                    <span className="sr-only">Incluido</span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#f1f5f9] text-[#94a3b8]" aria-hidden="true">
                      &#8212;
                    </span>
                    <span className="sr-only">No incluido, o requiere otra herramienta</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const FAQ_ITEMS: Array<{ question: string; answer: string }> = [
  {
    question: "¿Necesito tarjeta de crédito para probarlo?",
    answer: "No. El plan Gratis no pide tarjeta y te deja publicar tu portal de inmediato.",
  },
  {
    question: "¿Puedo pasar mis enlaces desde Linktree o Beacons?",
    answer: "Si. El asistente de bienvenida te deja cargar tus redes y enlaces existentes al elegir tu plantilla.",
  },
  {
    question: "¿El mini-CRM y los formularios tienen costo aparte?",
    answer: "No, vienen incluidos según los límites de tu plan; no son un addon ni otra suscripción.",
  },
  {
    question: "¿Mis datos y los de mis visitantes están seguros?",
    answer: "Cada organización está aislada dentro de la plataforma y los formularios cumplen buenas prácticas de validación y privacidad.",
  },
  {
    question: "¿Puedo cambiar de plan más adelante?",
    answer: "Si, podés subir o bajar de plan cuando quieras desde el panel; los límites se ajustan de inmediato.",
  },
];

export function FaqAccordion({ items }: { items: Array<{ question: string; answer: string }> }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <details key={item.question} className="group rounded-2xl border border-[#e2e8f0] bg-white px-5 py-4 open:shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-[#0f172a] focus-visible:outline-2 focus-visible:outline-offset-2">
            {item.question}
            <span className="shrink-0 text-[#0f6f6b] transition-transform group-open:rotate-45" aria-hidden="true">
              +
            </span>
          </summary>
          <p className="mt-3 text-sm text-[#64748b]">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
