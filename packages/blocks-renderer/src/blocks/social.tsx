import type { SocialBlockConfig } from "@impulza/validation";
import { NETWORK_LABELS, NetworkIcon } from "../ui/network-icon.js";
import { SURFACE_SCOPE } from "../ui/surface.js";

export function SocialBlock({ config }: { config: SocialBlockConfig }) {
  const isButtons = config.style === "buttons";

  return (
    <ul
      className={
        isButtons
          ? "flex flex-col gap-2"
          : "flex flex-wrap items-center justify-center gap-3"
      }
    >
      {config.links.map((link, index) => (
        <li key={`${link.network}-${index}`}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={NETWORK_LABELS[link.network]}
            className={
              isButtons
                ? `${SURFACE_SCOPE} flex items-center gap-3 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] px-4 py-3 text-sm font-medium text-[var(--site-color-foreground)] shadow-[var(--site-shadow)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2`
                : `${SURFACE_SCOPE} flex h-11 w-11 items-center justify-center rounded-full border border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-[var(--site-color-foreground)] shadow-[var(--site-shadow)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2`
            }
          >
            <NetworkIcon network={link.network} className="h-5 w-5 shrink-0" />
            {isButtons ? <span>{NETWORK_LABELS[link.network]}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
