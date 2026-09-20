import { Globe } from "lucide-react";
import type { SocialBlockConfig } from "@impulza/validation";

// Nombres legibles de la lista blanca de redes (F2.4) — el visible en texto, ya que no hay logos
// exactos disponibles (ver components/blocks/link.tsx).
const NETWORK_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  whatsapp: "WhatsApp",
  threads: "Threads",
  pinterest: "Pinterest",
  spotify: "Spotify",
  github: "GitHub",
  website: "Sitio web",
};

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
            aria-label={NETWORK_LABELS[link.network] ?? link.network}
            className={
              isButtons
                ? "flex items-center gap-3 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] px-4 py-3 text-sm font-medium text-[var(--site-color-foreground)] shadow-[var(--site-shadow)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
                : "flex h-11 w-11 items-center justify-center rounded-full border border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-[var(--site-color-foreground)] shadow-[var(--site-shadow)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
            }
          >
            <Globe className="h-5 w-5 shrink-0" aria-hidden="true" />
            {isButtons ? <span>{NETWORK_LABELS[link.network] ?? link.network}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}
