import type { ShowcaseBlockConfig } from "@impulza/validation";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { SiteImage } from "../ui/site-image.js";

/**
 * Colecciones (F10): tarjetas grandes con portada que llevan al álbum, la galería completa, la página web o a otro perfil
 * biográfico del negocio. Es el «botón con diseño propio» de un portal profesional.
 *
 * Legibilidad (WCAG 2.2 AA): el texto va **sobre un velo oscuro sólido en la parte baja** de la portada, con letra blanca,
 * así el contraste no depende de la foto. La tarjeta entera es un solo enlace con un nombre accesible claro.
 */
export function ShowcaseBlock({ config }: { config: ShowcaseBlockConfig }) {
  const grid = config.layout === "grid";
  return (
    <section aria-label={config.title ?? "Colecciones"} className="flex flex-col gap-4">
      {config.title ? (
        <h2 className="text-center text-lg font-semibold tracking-wide text-[var(--site-color-foreground)]" style={{ fontFamily: "var(--site-font-heading)" }}>
          {config.title}
        </h2>
      ) : null}
      <ul className={grid ? "grid grid-cols-1 gap-4 @sm:grid-cols-2" : "flex flex-col gap-4"}>
        {config.items.map((item, index) => (
          <li key={index}>
            <a
              href={item.link}
              {...OUTBOUND_LINK}
              aria-label={`${item.title}${item.subtitle ? `, ${item.subtitle}` : ""}: ${config.actionLabel}`}
              className={`group relative block overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] shadow-[var(--site-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))] ${grid ? "aspect-[4/5]" : "aspect-[16/10]"}`}
            >
              <SiteImage
                image={{ url: item.image.url, alt: item.image.alt || item.title, decorative: item.image.decorative }}
                sizes="(min-width: 544px) 496px, calc(100vw - 32px)"
                className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
              {item.badge ? (
                <span className="absolute left-3 top-3 rounded-full bg-black/75 px-3 py-1 text-xs font-medium tracking-wide text-white">{item.badge}</span>
              ) : null}
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/90 via-black/75 to-transparent px-4 pb-4 pt-12 text-white">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-lg font-semibold" style={{ fontFamily: "var(--site-font-heading)" }}>
                    {item.title}
                  </span>
                  {item.subtitle ? <span className="truncate text-sm text-white/85">{item.subtitle}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-sm font-medium">
                  {config.actionLabel}
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none">
                    <path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
