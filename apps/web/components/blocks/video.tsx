import type { VideoBlockConfig } from "@impulza/validation";

// Plantilla fija por proveedor — nunca una URL de iframe libre (F2.4, misma razón que
// `parseVideoUrl`): lo único que puede variar es el id, ya validado por la lista blanca de
// caracteres del esquema.
const EMBED_SRC: Record<VideoBlockConfig["video"]["provider"], (id: string) => string> = {
  youtube: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
  vimeo: (id) => `https://player.vimeo.com/video/${id}`,
};

export function VideoBlock({ config }: { config: VideoBlockConfig }) {
  const src = EMBED_SRC[config.video.provider](config.video.videoId);

  return (
    <figure className="m-0">
      <div className="aspect-video overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-color-border)] shadow-[var(--site-shadow)]">
        <iframe
          src={src}
          title={config.title ?? "Video"}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
      {config.title ? (
        <figcaption className="mt-2 text-center text-sm text-[var(--site-color-muted-foreground)]">
          {config.title}
        </figcaption>
      ) : null}
    </figure>
  );
}
