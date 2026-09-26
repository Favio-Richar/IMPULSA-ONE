import { BadgeCheck } from "lucide-react";
import type { ProfileBlockConfig } from "@impulza/validation";
import { RichText } from "../ui/rich-text.js";
import { SiteImage } from "../ui/site-image.js";
import { SocialButtonLinks } from "../ui/social-button-links.js";

/** Hasta dos iniciales del nombre ("Café Aroma" → "CA"), para el monograma sin foto (PP8). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0]!, words[words.length - 1]!] : words.slice(0, 1)).map((word) => [...word][0] ?? "");
  return letters.join("").toLocaleUpperCase("es");
}

/**
 * Encabezado de perfil (PP4): portada, avatar montado sobre su borde inferior, nombre con
 * verificación, frase, bio y redes como botones de la pila (ADR-008). Todo es opcional salvo el nombre, así que un perfil
 * guardado antes de PP4 (sin portada ni redes) se ve igual que siempre.
 *
 * Sobre la portada no va texto: solo el avatar, con un marco del color de fondo del tema que lo
 * separa de la foto. Por eso la portada no necesita capa de legibilidad — el texto queda debajo,
 * sobre el fondo de la página, cuyo contraste ya garantizan el tema y el fondo (PP3).
 */
export function ProfileBlock({ config, glass = false }: { config: ProfileBlockConfig; glass?: boolean }) {
  const hasCover = config.cover !== undefined;

  return (
    <div className="flex flex-col items-center text-center">
      {config.cover ? (
        <div
          data-profile-cover=""
          // PL5 (ADR-008): a sangre en el teléfono (ver `styles/site.css`); redondeada en pantallas anchas.
          className="aspect-[16/8] w-full overflow-hidden rounded-[var(--site-radius)] bg-[var(--site-color-surface)]"
        >
          <SiteImage image={config.cover} priority className="h-full w-full object-cover" />
        </div>
      ) : null}

      {config.avatar ? (
        <SiteImage
          image={config.avatar}
          priority
          sizes="128px"
          width={128}
          height={128}
          className={`relative h-32 w-32 rounded-full object-cover shadow-[var(--site-shadow)] ${
            hasCover
              ? "-mt-16 border-4 border-[var(--site-color-background)] bg-[var(--site-color-background)]"
              : "border border-[var(--site-color-border)]"
          }`}
        />
      ) : (
        // PP8: sin foto, las iniciales en el color del tema (par primario/texto verificado AA). La
        // cabecera de una página de enlaces siempre tiene un "rostro" arriba.
        <span
          aria-hidden="true"
          data-profile-monogram=""
          className={`relative flex h-32 w-32 items-center justify-center rounded-full bg-[var(--site-color-primary)] text-4xl font-semibold text-[var(--site-color-primary-foreground)] shadow-[var(--site-shadow)] ${
            hasCover ? "-mt-16 border-4 border-[var(--site-color-background)]" : ""
          }`}
          style={{ fontFamily: "var(--site-font-heading)" }}
        >
          {initials(config.name)}
        </span>
      )}

      <div className="mt-4 flex w-full flex-col items-center gap-3">
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
          <nav aria-label={`Redes de ${config.name}`} className="w-full pt-1">
            <SocialButtonLinks links={config.socials} glass={glass} />
          </nav>
        ) : null}
      </div>
    </div>
  );
}
