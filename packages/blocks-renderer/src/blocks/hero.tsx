import type { HeroBlockConfig } from "@impulza/validation";
import { LinkButton, type ButtonVariant } from "../ui/link-button.js";
import { SiteImage } from "../ui/site-image.js";

const ALIGN_CLASSES: Record<HeroBlockConfig["alignment"], string> = {
  left: "text-left items-start",
  center: "text-center items-center",
  right: "text-right items-end",
};

export function HeroBlock({
  config,
  buttonVariant,
}: {
  config: HeroBlockConfig;
  buttonVariant: ButtonVariant;
}) {
  return (
    <div className="relative overflow-hidden rounded-[var(--site-radius)]">
      {config.background ? (
        <>
          <SiteImage image={config.background} className="absolute inset-0 h-full w-full object-cover" />
          {/* Velo oscuro fijo: el texto tiene que seguir cumpliendo contraste AA sin importar qué
              tan clara sea la imagen que suba cada sitio — no se puede confiar en el contenido. */}
          <div className="absolute inset-0 bg-black/45" />
        </>
      ) : null}

      <div
        className={`relative flex flex-col gap-4 px-6 py-16 sm:px-10 sm:py-20 ${ALIGN_CLASSES[config.alignment]} ${
          config.background ? "text-white" : "text-[var(--site-color-foreground)]"
        }`}
        style={config.background ? undefined : { backgroundColor: "var(--site-color-surface)" }}
      >
        <h1 className="text-3xl font-semibold sm:text-4xl">{config.title}</h1>
        {config.subtitle ? (
          <p className={`max-w-xl text-lg ${config.background ? "text-white/90" : "text-[var(--site-color-muted-foreground)]"}`}>
            {config.subtitle}
          </p>
        ) : null}
        {config.cta ? (
          <div className="pt-2">
            <LinkButton href={config.cta.url} variant={buttonVariant}>
              {config.cta.label}
            </LinkButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
