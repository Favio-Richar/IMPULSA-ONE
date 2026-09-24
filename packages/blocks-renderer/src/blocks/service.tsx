import type { ServiceBlockConfig } from "@impulza/validation";
import { LinkButton, type ButtonVariant } from "../ui/link-button.js";
import { RichText } from "../ui/rich-text.js";
import { SiteImage } from "../ui/site-image.js";
import { formatPrice } from "../lib/format-price.js";

export function ServiceBlock({
  config,
  buttonVariant,
}: {
  config: ServiceBlockConfig;
  buttonVariant: ButtonVariant;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-5 shadow-[var(--site-shadow)] sm:flex-row">
      {config.image ? (
        <SiteImage
          image={config.image}
          className="h-40 w-full shrink-0 rounded-[var(--site-radius)] border border-[var(--site-color-border)] object-cover sm:h-auto sm:w-40"
        />
      ) : null}

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold text-[var(--site-color-foreground)]">{config.name}</h3>
          {config.priceAmount !== undefined && config.priceCurrency ? (
            <span className="font-medium text-[var(--site-color-primary)]">
              {formatPrice(config.priceAmount, config.priceCurrency)}
            </span>
          ) : null}
        </div>

        {config.description ? <RichText html={config.description} className="text-sm" /> : null}

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
