import type { TemplateResponse } from "@impulza/contracts";
import { TEMPLATE_INDUSTRY_LABELS } from "@impulza/validation";
import Link from "next/link";
import { pageTitle, templateHasSubscription, templatePageCount } from "../../lib/template-gallery";
import { ClientTemplateThumbnail } from "./client-template-thumbnail";

/** Páginas visibles en la barra del teléfono; el resto se resume en «+N». */
const NAV_VISIBLE = 3;

/**
 * Tarjeta de la galería pública: la plantilla real dentro de un marco de teléfono (bisel oscuro, barra superior con su código y
 * las páginas reales, desvanecido al pie que indica que el contenido continúa), y debajo nombre, descripción y etiquetas. El
 * enlace va superpuesto (no envuelve la miniatura, que trae sus propios `<a>`): mismo criterio que `TemplateCardLink`.
 */
export function TemplateGalleryCard({ template }: { template: TemplateResponse }) {
  const subscription = templateHasSubscription(template);
  const pages = ["Inicio", ...(template.companionPages ?? []).map((page) => pageTitle(page.slug))];
  const visible = pages.slice(0, NAV_VISIBLE);
  const hidden = pages.length - visible.length;

  return (
    <article className="group relative flex h-full flex-col items-center gap-5 rounded-3xl border border-[#e2e8f0] bg-gradient-to-b from-[#f8fafc] to-white px-5 pb-6 pt-7 transition-[border-color,transform,box-shadow] duration-300 hover:-translate-y-1 hover:border-[#94a3b8] hover:shadow-[0_18px_40px_-24px_rgba(15,23,42,0.35)] focus-within:-translate-y-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#0f6f6b] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div aria-hidden="true" className="w-full max-w-[17.5rem] rounded-[2.4rem] bg-[#0f172a] p-2.5 shadow-[0_20px_36px_-20px_rgba(15,23,42,0.55)] ring-1 ring-[#1e293b]">
        <div className="relative overflow-hidden rounded-[1.9rem] bg-white">
          <div className="flex h-8 items-center justify-between gap-2 bg-[#1e293b] px-3.5 text-[0.625rem] leading-none text-[#e2e8f0]">
            <span className="min-w-0 truncate font-semibold tracking-wide text-white">{template.code}</span>
            <span className="flex shrink-0 items-center gap-2 text-[#cbd5e1]">
              {visible.map((label, index) => (
                <span key={label} className={index === 0 ? "font-semibold text-white" : undefined}>
                  {label}
                </span>
              ))}
              {hidden > 0 ? <span className="text-[#94a3b8]">+{hidden}</span> : null}
            </span>
          </div>
          <ClientTemplateThumbnail template={template} height={360} fitWidth />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white/95 via-white/55 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto h-1 w-16 rounded-full bg-[#0f172a]/25" />
        </div>
      </div>
      <div className="flex w-full flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-lg font-semibold tracking-tight text-[#0f172a]">
            <Link href={`/plantillas/${template.code}`} className="after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none group-has-[:focus-visible]:underline">
              {template.name}
            </Link>
          </h3>
          <p className="line-clamp-2 text-sm leading-relaxed text-[#475569]">{template.description}</p>
        </div>
        <ul className="mt-auto flex flex-wrap gap-1.5" aria-label="Detalles">
          <li className={`rounded-full px-2.5 py-1 text-xs font-semibold ${subscription ? "bg-[#e6f5f3] text-[#0b5450]" : "border border-[#e2e8f0] bg-white text-[#475569]"}`}>
            {subscription ? "Con suscripción" : "Sin suscripción"}
          </li>
          <li className="rounded-full border border-[#e2e8f0] bg-white px-2.5 py-1 text-xs font-medium text-[#475569]">{templatePageCount(template)} páginas</li>
          {template.industryTags.slice(0, 2).map((tag) => (
            <li key={tag} className="rounded-full border border-[#e2e8f0] bg-white px-2.5 py-1 text-xs font-medium text-[#475569]">
              {TEMPLATE_INDUSTRY_LABELS[tag]}
            </li>
          ))}
        </ul>
        <span aria-hidden="true" className="inline-flex items-center gap-1 text-sm font-semibold text-[#0f6f6b] transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none">
          Ver plantilla →
        </span>
      </div>
    </article>
  );
}
