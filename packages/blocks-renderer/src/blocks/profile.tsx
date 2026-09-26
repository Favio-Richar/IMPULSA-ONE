import { BadgeCheck } from "lucide-react";
import type { ProfileBlockConfig } from "@impulza/validation";
import { RichText } from "../ui/rich-text.js";
import { SiteImage } from "../ui/site-image.js";
import { SocialIconLinks } from "../ui/social-icon-links.js";

/**
 * Encabezado de perfil (PP4): portada, avatar montado sobre su borde inferior, nombre con
 * verificación, frase, bio y fila de redes. Todo es opcional salvo el nombre, así que un perfil
 * guardado antes de PP4 (sin portada ni redes) se ve igual que siempre.
 *
 * Sobre la portada no va texto: solo el avatar, con un marco del color de fondo del tema que lo
 * separa de la foto. Por eso la portada no necesita capa de legibilidad — el texto queda debajo,
 * sobre el fondo de la página, cuyo contraste ya garantizan el tema y el fondo (PP3).
 */
export function ProfileBlock({ config }: { config: ProfileBlockConfig }) {
  const hasCover = config.cover !== undefined;

  return (
    <div className="flex flex-col items-center text-center">
      {config.cover ? (
        <div
          data-profile-cover=""
          className="aspect-[16/7] w-full overflow-hidden rounded-[var(--site-radius)] bg-[var(--site-color-surface)] sm:aspect-[16/6]"
        >
          <SiteImage image={config.cover} priority className="h-full w-full object-cover" />
        </div>
      ) : null}

      {config.avatar ? (
        <SiteImage
          image={config.avatar}
          priority
          sizes="112px"
          width={112}
          height={112}
          className={`relative h-28 w-28 rounded-full object-cover shadow-[var(--site-shadow)] ${
            hasCover
              ? "-mt-14 border-4 border-[var(--site-color-background)] bg-[var(--site-color-background)]"
              : "border border-[var(--site-color-border)]"
          }`}
        />
      ) : null}

      <div className={`flex flex-col items-center gap-3 ${config.avatar || hasCover ? "mt-4" : ""}`}>
        <div className="flex items-center gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--site-color-foreground)] sm:text-3xl">
            {config.name}
          </h1>
          {config.verified ? (
            <BadgeCheck className="h-5 w-5 shrink-0 text-[var(--site-color-link)]" aria-label="Perfil verificado" />
          ) : null}
        </div>

        {config.headline ? <p className="text-[var(--site-color-muted-foreground)]">{config.headline}</p> : null}

        {config.bio ? <RichText html={config.bio} className="max-w-xl text-sm" /> : null}

        {config.socials && config.socials.length > 0 ? (
          <nav aria-label={`Redes de ${config.name}`} className="pt-1">
            <SocialIconLinks links={config.socials} />
          </nav>
        ) : null}
      </div>
    </div>
  );
}
