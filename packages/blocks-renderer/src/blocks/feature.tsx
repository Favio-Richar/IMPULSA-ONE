import type { FeatureBlockConfig } from "@impulza/validation";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { RichText } from "../ui/rich-text.js";
import { SiteImage } from "../ui/site-image.js";
import { WideBleed } from "../ui/wide-bleed.js";

/**
 * Imagen y texto (F10): la historia con foto. En pantallas anchas, dos columnas (la foto a la izquierda o a la derecha
 * según se elija); en el teléfono, la foto arriba y el texto debajo. El texto enriquecido ya viene saneado por el
 * servidor (`richTextPaths`).
 */
export function FeatureBlock({ config, mode = "public" }: { config: FeatureBlockConfig; mode?: "public" | "preview" }) {
  const imageRight = config.imagePosition === "right";
  return (
    <WideBleed mode={mode} size="lg">
      <section className="@container">
        <div className="grid items-center gap-6 @2xl:grid-cols-2 @2xl:gap-10">
          <div className={`overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-color-border)] shadow-[var(--site-shadow)] ${imageRight ? "@2xl:order-2" : ""}`}>
            <SiteImage
              image={{ url: config.image.url, alt: config.image.alt || config.title, decorative: config.image.decorative }}
              sizes="(min-width: 768px) 440px, calc(100vw - 32px)"
              className="aspect-[4/5] w-full object-cover @2xl:aspect-[5/6]"
            />
          </div>
          <div className="flex flex-col gap-3">
            {config.eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--site-color-muted-foreground)]">{config.eyebrow}</p>
            ) : null}
            <h2 className="text-balance text-3xl font-semibold leading-tight text-[var(--site-color-foreground)]" style={{ fontFamily: "var(--site-font-heading)" }}>
              {config.title}
            </h2>
            <RichText html={config.text} />
            {config.cta ? (
              <a
                href={config.cta.url}
                {...OUTBOUND_LINK}
                className="mt-2 inline-flex min-h-11 w-fit items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-6 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))]"
              >
                {config.cta.label}
              </a>
            ) : null}
          </div>
        </div>
      </section>
    </WideBleed>
  );
}
