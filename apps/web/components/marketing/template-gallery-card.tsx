import type { TemplateResponse } from "@impulza/contracts";
import { TEMPLATE_INDUSTRY_LABELS } from "@impulza/validation";
import Link from "next/link";
import { blocksSummary, pageTitle, templateHasSubscription } from "../../lib/template-gallery";
import { ClientTemplateThumbnail } from "./client-template-thumbnail";

/** Alto de la pantalla del teléfono (px): proporción de un móvil real, igual en todas las tarjetas. */
const SCREEN_HEIGHT = 580;

type SeedBlock = { type: string; config?: unknown };

/** Rasgos de diseño de la plantilla que vale la pena destacar como etiqueta (cabecera, índice, esfera 3D). */
function designTags(template: TemplateResponse): string[] {
  const blocks: SeedBlock[] = [...template.blocks, ...(template.companionPages ?? []).flatMap((page) => page.blocks)];
  const layoutOf = (type: string) => blocks.find((block) => block.type === type)?.config as { layout?: string } | undefined;
  const tags: string[] = [];
  const profile = layoutOf("profile")?.layout;
  if (profile === "banner") tags.push("Banner");
  if (profile === "cutout") tags.push("Recorte");
  if (blocks.some((block) => block.type === "showcase" && (block.config as { layout?: string } | undefined)?.layout === "index")) tags.push("Índice");
  if (blocks.some((block) => block.type === "gallery" && (block.config as { layout?: string } | undefined)?.layout === "sphere")) tags.push("Esfera 3D");
  return tags;
}

/**
 * Tarjeta de la galería pública: la plantilla real (mismo motor que un sitio publicado) dentro de un teléfono de bisel
 * oscuro y grueso, con proporción de móvil real; debajo, el nombre con su número, el código, las páginas internas con lo que
 * incluyen y las etiquetas (suscripción y rasgos de diseño). El enlace de la tarjeta va superpuesto (la miniatura trae sus
 * propios `<a>`); el botón «Usar» queda por encima para ser clicable por separado.
 */
export function TemplateGalleryCard({ template, useHref, index }: { template: TemplateResponse; useHref?: string; index?: number }) {
  const subscription = templateHasSubscription(template);
  const companions = (template.companionPages ?? []).map((page) => ({ slug: page.slug, summary: blocksSummary(page.blocks).join(", ") }));
  const industry = template.industryTags[0];
  const tags = designTags(template);

  return (
    <article className="group relative mx-auto flex h-full w-full max-w-[19.5rem] flex-col gap-4 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-8 has-[a:focus-visible]:outline-[#0f6f6b]">
      <div className="rounded-[2.6rem] bg-[#10272a] p-2 shadow-[0_22px_40px_-22px_rgba(15,23,42,0.6)] ring-1 ring-black/20 transition-[transform,box-shadow] duration-300 group-hover:-translate-y-1.5 group-hover:shadow-[0_32px_50px_-24px_rgba(15,23,42,0.65)] group-focus-within:-translate-y-1.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        <div className="relative overflow-hidden rounded-[2.1rem] bg-white" style={{ height: SCREEN_HEIGHT }}>
          <ClientTemplateThumbnail template={template} height={SCREEN_HEIGHT} fitWidth />
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-tight text-[#0f172a]">
            <Link href={`/plantillas/${template.code}`} className="after:absolute after:inset-0 after:z-0 focus-visible:outline-none">
              {template.name}
            </Link>
          </h3>
          {index ? <span className="shrink-0 font-mono text-xs text-[#64748b]">rubro {index}</span> : null}
        </div>

        <p className="font-mono text-xs font-semibold text-[#0f6f6b]">{template.code}</p>

        {companions.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-[0.8rem] leading-snug text-[#475569]" aria-label="Páginas incluidas">
            {companions.map((page) => (
              <li key={page.slug}>
                <span className="font-mono font-semibold text-[#0f172a]">/{page.slug}</span>
                {page.summary ? <span> · {page.summary}</span> : <span> · {pageTitle(page.slug)}</span>}
              </li>
            ))}
          </ul>
        ) : null}

        <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="Etiquetas">
          <li
            className={`rounded-full px-3 py-1 text-xs font-medium ${subscription ? "bg-[#d9f2ee] text-[#0b5551]" : "bg-white text-[#475569] ring-1 ring-[#cbd5e1]"}`}
          >
            {subscription ? "Con suscripción" : "Sin suscripción"}
          </li>
          {tags.map((tag) => (
            <li key={tag} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#0b5551] ring-1 ring-[#0f6f6b]/60">
              {tag}
            </li>
          ))}
          {industry ? (
            <li className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-medium text-[#475569]">{TEMPLATE_INDUSTRY_LABELS[industry]}</li>
          ) : null}
        </ul>

        <div className="mt-1 flex items-center justify-between gap-3 border-t border-[#e2e8f0] pt-3">
          <span aria-hidden="true" className="text-sm font-semibold text-[#0f172a] transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none">
            Ver plantilla →
          </span>
          {useHref ? (
            <a
              href={useHref}
              className="relative z-10 inline-flex min-h-10 items-center rounded-full bg-[#0f6f6b] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f6f6b]"
              aria-label={`Usar la plantilla ${template.name}`}
            >
              Usar plantilla
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
