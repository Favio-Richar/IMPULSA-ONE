import type { ImageBlockConfig } from "@impulza/validation";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { SiteImage } from "../ui/site-image.js";

export function ImageBlock({ config }: { config: ImageBlockConfig }) {
  const figure = (
    <figure className="m-0">
      <SiteImage
        image={config.image}
        className="w-full rounded-[var(--site-radius)] border border-[var(--site-color-border)] object-cover shadow-[var(--site-shadow)]"
      />
      {config.caption ? (
        <figcaption className="mt-2 text-center text-sm text-[var(--site-color-muted-foreground)]">
          {config.caption}
        </figcaption>
      ) : null}
    </figure>
  );

  if (!config.link) {
    return figure;
  }

  return (
    <a href={config.link} {...OUTBOUND_LINK} className="block">
      {figure}
    </a>
  );
}
