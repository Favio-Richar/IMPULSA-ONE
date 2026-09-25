import { BadgeCheck } from "lucide-react";
import type { ProfileBlockConfig } from "@impulza/validation";
import { RichText } from "../ui/rich-text.js";
import { SiteImage } from "../ui/site-image.js";

export function ProfileBlock({ config }: { config: ProfileBlockConfig }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {config.avatar ? (
        <SiteImage
          image={config.avatar}
          priority
          sizes="112px"
          width={112}
          height={112}
          className="h-28 w-28 rounded-full border border-[var(--site-color-border)] object-cover shadow-[var(--site-shadow)]"
        />
      ) : null}

      <div className="flex items-center gap-1.5">
        <h1 className="text-2xl font-semibold text-[var(--site-color-foreground)]">{config.name}</h1>
        {config.verified ? (
          <BadgeCheck
            className="h-5 w-5 shrink-0 text-[var(--site-color-link)]"
            aria-label="Perfil verificado"
          />
        ) : null}
      </div>

      {config.headline ? (
        <p className="text-[var(--site-color-muted-foreground)]">{config.headline}</p>
      ) : null}

      {config.bio ? <RichText html={config.bio} className="text-sm" /> : null}
    </div>
  );
}
