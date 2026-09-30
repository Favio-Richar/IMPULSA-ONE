import { musicEmbedHeight, musicEmbedSrc, musicPublicUrl, MUSIC_PROVIDER_LABELS, type MusicBlockConfig } from "@impulza/validation";
import { OUTBOUND_LINK } from "../ui/outbound.js";

/**
 * Música (F7.3, ADR-018): el reproductor oficial de Spotify, SoundCloud o Apple Music desde una
 * plantilla fija por proveedor (nunca una URL de iframe escrita por el usuario), con `sandbox` como
 * defensa extra, y debajo un enlace para escucharla en la aplicación (sirve también si el
 * reproductor no carga).
 */
export function MusicBlock({ config }: { config: MusicBlockConfig }) {
  const provider = MUSIC_PROVIDER_LABELS[config.music.provider];
  return (
    <figure className="m-0 flex flex-col gap-2" data-music={config.music.provider}>
      <div className="overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-color-border)] shadow-[var(--site-shadow)]">
        <iframe
          src={musicEmbedSrc(config.music)}
          title={config.title ? `${config.title} (${provider})` : `Reproductor de ${provider}`}
          height={musicEmbedHeight(config.music)}
          className="block w-full border-0"
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-storage-access-by-user-activation"
        />
      </div>
      <figcaption className="flex flex-wrap items-center justify-center gap-x-2 text-center text-sm text-[var(--site-color-muted-foreground)]">
        {config.title ? <span>{config.title}</span> : null}
        <a href={musicPublicUrl(config.music)} {...OUTBOUND_LINK} className="underline underline-offset-2 text-[var(--site-color-link)] hover:opacity-80">
          Escuchar en {provider}
        </a>
      </figcaption>
    </figure>
  );
}
