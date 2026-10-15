import {
  backgroundTextCssVariables,
  getBackgroundGradient,
  gradientCss,
  mediaSrcSet,
  OVERLAY_COLORS,
  overlayCss,
  patternCss,
  type ResolvedSiteBackground,
  themeAltCssVariables,
  themeTokensToCssVariables,
  type ThemeTokens,
} from "@impulza/validation";
import type { CSSProperties, ReactNode } from "react";
import { BackgroundVideo } from "./background-video.js";
import { SiteModeToggle } from "./site-mode-toggle.js";
import { SiteMotionEnhancer } from "./site-motion-enhancer.js";

/** Color de base mientras carga la imagen o el video: el de la capa, así el texto ya se lee. */
function baseStyle(background: ResolvedSiteBackground): CSSProperties {
  switch (background.kind) {
    case "color":
      return { backgroundColor: background.color };
    case "gradient": {
      const gradient = getBackgroundGradient(background.gradient)!;
      return { backgroundColor: gradient.stops[0], backgroundImage: gradientCss(gradient) };
    }
    case "pattern":
      // Sin capa de legibilidad: el contraste ya se garantizó en el peor punto del trazo (`patternTextPalette`).
      return patternCss(background.pattern, background.color, background.ink);
    case "image":
    case "video":
      return { backgroundColor: OVERLAY_COLORS[background.overlay.tone] };
  }
}

/**
 * Tema + fondo de la página (PP3), compartido por el render público y la vista previa del
 * constructor para que se vean igual. Inyecta las variables del tema, cambia las del texto que va
 * directo sobre el fondo cuando hace falta (la paleta ya la decidió el servidor para alcanzar AA) y
 * pinta el fondo en una capa decorativa detrás del contenido.
 *
 * `fixed`: en el sitio público el fondo queda quieto al desplazarse; en la vista previa se limita al
 * marco (`absolute`), porque `fixed` se saldría del panel.
 */
export function SiteBackdrop({
  theme,
  background,
  fixed = true,
  className = "",
  showModeToggle = true,
  children,
}: {
  theme: ThemeTokens;
  background: ResolvedSiteBackground | null;
  fixed?: boolean;
  className?: string;
  /** `false` en miniaturas y en la vista previa del constructor: ahí el botón de día/noche no tiene sentido. */
  showModeToggle?: boolean;
  children: ReactNode;
}) {
  // Modo día/noche (F10): solo si el tema trae paleta alterna.
  const altVars = themeAltCssVariables(theme);
  const style = {
    ...themeTokensToCssVariables(theme),
    ...(background ? backgroundTextCssVariables(background.text) : {}),
    // Contorno de foco (PL5): el color de enlace **de la página**, fijado acá. Una variable propia y
    // no `--site-color-link`, porque las tarjetas redefinen el enlace y el contorno de un botón sobre
    // tarjeta se dibuja por fuera, sobre el fondo de la página. Ver `styles/site.css`.
    "--site-focus": "var(--site-color-link)",
    fontFamily: "var(--site-font-family)",
    // Con un fondo elegido, la raíz toma su color base (el del patrón o el color, el primero del degradado, el tono de la capa
    // de una foto o video) en vez del fondo del tema: lo que asoma al estirar la página en el teléfono o antes de pintar la
    // capa del fondo es del mismo tono que el texto ya espera, nunca el blanco de un tema claro bajo texto claro.
    ...(background ? { backgroundColor: baseStyle(background).backgroundColor } : {}),
  } as CSSProperties;

  return (
    <div
      style={style}
      // Ancla de `styles/site.css`: los títulos usan `--site-font-heading` (PP4).
      data-site-root=""
      data-background={background?.kind ?? "theme"}
      // F10: movimiento elegante del tema (aparición de los bloques guiada por el scroll, solo CSS).
      data-site-motion={theme.motion ?? "none"}
      className={`relative isolate bg-[var(--site-color-background)] text-[var(--site-color-foreground)] ${className}`}
    >
      {background ? (
        <div aria-hidden="true" data-site-backdrop="" className={`${fixed ? "fixed" : "absolute"} inset-0 -z-10 overflow-hidden`} style={baseStyle(background)}>
          {background.kind === "image" ? (
            <img
              src={background.image.url}
              srcSet={mediaSrcSet(background.image.url) ?? undefined}
              sizes="100vw"
              alt=""
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className={`absolute inset-0 h-full w-full object-cover ${background.effect ? `site-bg-${background.effect}` : ""}`}
            />
          ) : null}
          {background.kind === "video" ? <BackgroundVideo posterUrl={background.video.posterUrl} src={background.video.src} fixed={fixed} /> : null}
          {background.kind === "image" || background.kind === "video" ? (
            <div data-overlay={`${background.overlay.tone}-${background.overlay.strength}`} className="absolute inset-0" style={{ backgroundColor: overlayCss(background.overlay) }} />
          ) : null}
        </div>
      ) : null}
      {theme.motion === "elegant" && showModeToggle ? <SiteMotionEnhancer /> : null}
      {altVars && showModeToggle ? <SiteModeToggle altVars={{ ...altVars }} baseBackground={theme.palette.background} /> : null}
      {children}
    </div>
  );
}
