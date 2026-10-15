"use client";

import { Clapperboard, Lightbulb, Rocket } from "lucide-react";
import { useSyncExternalStore } from "react";

/**
 * Contenido de los paneles laterales del asistente. Sin marcas ni logos de terceros (ADR-008).
 * El video actual es un clip de stock de Pexels (licencia Pexels: uso comercial sin atribución; autor Mizuno K, id 13736547),
 * recodificado a 540×960 (el panel mide 256 px; alcanza para pantallas 2×) y con `+faststart`, para que el primer cuadro llegue
 * enseguida. El póster es el primer cuadro del mismo video (ffmpeg): mientras el video carga se ve esa imagen real, nunca un
 * fondo de color. Para reemplazarlo, sube ambos archivos a `apps/dashboard/public/onboarding/` y cambia aquí las rutas. Con
 * `videoUrl: null` se muestra un marcador con texto.
 */
export const ONBOARDING_PROMO: { videoUrl: string | null; posterUrl: string | null } = {
  videoUrl: "/onboarding/demo-portal.mp4",
  posterUrl: "/onboarding/demo-portal-poster.jpg",
};

/** Debajo de este ancho no hay espacio libre a los costados del asistente (`max-w-6xl`): los paneles no se montan. */
const WIDE_QUERY = "(min-width: 1700px)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// --- Ilustraciones de los consejos ---------------------------------------------------------------
// Miniaturas del propio producto dibujadas con los tokens del sistema (no fotos de stock ni íconos de línea): cada una muestra
// lo que dice su consejo. Son decorativas, igual que todo el panel.

/** Consejo destacado: una página en miniatura con la paleta y las fuentes que se pueden cambiar. */
function CustomizeArt(): React.JSX.Element {
  return (
    // Crece con el alto disponible: el dibujo queda centrado, así el panel no deja un hueco al pie en pantallas altas.
    <div className="relative flex min-h-36 flex-1 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-primary/15 via-surface to-info/10 pb-6">
      <div className="flex w-24 -rotate-2 flex-col items-center gap-1.5 rounded-md border border-border bg-background p-2.5 shadow-sm">
        <span className="size-6 rounded-full bg-primary" />
        <span className="h-1.5 w-12 rounded-sm bg-foreground/70" />
        <span className="mt-1 h-3.5 w-full rounded-sm bg-primary" />
        <span className="h-3.5 w-full rounded-sm border border-border" />
        <span className="h-3.5 w-full rounded-sm border border-border" />
      </div>
      <div className="-ml-6 mt-8 flex flex-col gap-2 rounded-md border border-border bg-background p-2.5 shadow-md">
        <div className="flex gap-1.5">
          <span className="size-4 rounded-full bg-primary ring-2 ring-primary/30 ring-offset-1" />
          <span className="size-4 rounded-full bg-info" />
          <span className="size-4 rounded-full bg-warning" />
          <span className="size-4 rounded-full bg-foreground" />
        </div>
        <div className="flex items-baseline gap-2 text-foreground">
          <span className="font-serif text-lg leading-none">Aa</span>
          <span className="text-lg font-semibold leading-none">Aa</span>
          <span className="font-mono text-sm leading-none text-muted-foreground">Aa</span>
        </div>
      </div>
      <span className="absolute bottom-3 right-4 rounded-sm bg-background/90 px-2 py-0.5 text-[10px] font-medium text-primary shadow-sm">
        Cambios guardados
      </span>
    </div>
  );
}

/** Una pila de botones donde solo uno está destacado. */
function MainButtonArt(): React.JSX.Element {
  return (
    <div className="flex size-full flex-col justify-center gap-1 rounded-md bg-surface p-2">
      <span className="h-2.5 w-full rounded-sm bg-primary shadow-sm" />
      <span className="h-2.5 w-full rounded-sm border border-border-strong bg-background" />
      <span className="h-2.5 w-full rounded-sm border border-border-strong bg-background" />
    </div>
  );
}

/** Patrón fijo de un código QR (5×5, no codifica nada: es un dibujo). */
const QR_CELLS = [1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1];

function ShareArt(): React.JSX.Element {
  return (
    <div className="flex size-full items-center justify-center rounded-md bg-surface">
      <div className="grid grid-cols-5 gap-px rounded-sm border border-border bg-background p-1">
        {QR_CELLS.map((on, index) => (
          <span key={index} className={on ? "size-1.5 bg-foreground" : "size-1.5"} />
        ))}
      </div>
    </div>
  );
}

/** Rejilla de plantillas con la primera marcada como la más adecuada. */
function TemplatesArt(): React.JSX.Element {
  return (
    <div className="grid size-full grid-cols-2 gap-1 rounded-md bg-surface p-1.5">
      <span className="rounded-sm border-2 border-primary bg-primary/15" />
      <span className="rounded-sm border border-border bg-background" />
      <span className="rounded-sm border border-border bg-background" />
      <span className="rounded-sm border border-border bg-foreground/80" />
    </div>
  );
}

/** Gráfico de barras ascendente. */
function StatsArt(): React.JSX.Element {
  return (
    <div className="flex size-full items-end justify-center gap-1 rounded-md bg-surface px-2 pb-2 pt-3">
      {[30, 45, 40, 65, 90].map((height, index) => (
        <span key={index} className={index === 4 ? "w-1.5 rounded-t-sm bg-primary" : "w-1.5 rounded-t-sm bg-primary/35"} style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

const FEATURED_TIP = {
  title: "Todo se puede cambiar",
  text: "Colores, fuentes y bloques se editan después sin perder tu contenido. Elige rápido y ajusta con calma.",
};

const TIPS: ReadonlyArray<{ art: () => React.JSX.Element; title: string; text: string }> = [
  { art: MainButtonArt, title: "Un botón principal", text: "Una acción destacada convierte mejor que muchas a la vez." },
  { art: ShareArt, title: "Compártela donde estés", text: "Tu dirección y tu QR sirven en redes, tarjetas y mensajes." },
  { art: TemplatesArt, title: "Tu rubro ordena las plantillas", text: "Primero ves las que mejor encajan con lo que haces." },
  { art: StatsArt, title: "Mide lo que pasa", text: "Desde el panel ves las visitas y los clics de tu página." },
];

/**
 * Paneles decorativos a los costados del asistente, solo en pantallas muy anchas. Son secciones estructurales pegadas al borde
 * de la ventana y a todo el alto bajo el encabezado (fijas: no se desplazan con la página); solo redondean el lado que mira al
 * contenido. Son puramente visuales (`aria-hidden`, sin foco ni clics): el flujo del paso no depende de ellos. En pantallas
 * angostas no se renderizan, y el video ni se pide.
 */
export function AssistantSidePanels(): React.JSX.Element | null {
  const wide = useMediaQuery(WIDE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_QUERY);
  if (!wide) {
    return null;
  }
  const { videoUrl, posterUrl } = ONBOARDING_PROMO;

  return (
    <div
      aria-hidden="true"
      data-testid="onboarding-side-panels"
      className="pointer-events-none fixed inset-x-0 bottom-0 top-14 z-0 hidden justify-between min-[1700px]:flex"
    >
      {/* Fondo neutro oscuro (no el color de marca): si el video tarda, lo que asoma es el póster o un tono neutro, nunca un tinte. */}
      <aside className="relative h-full w-64 overflow-hidden rounded-none border-r border-border bg-neutral-900 text-white">
        {videoUrl ? (
          <video
            className="absolute inset-0 size-full object-cover"
            src={videoUrl}
            poster={posterUrl ?? undefined}
            muted
            loop
            playsInline
            autoPlay={!reducedMotion}
            preload="auto"
            tabIndex={-1}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Clapperboard className="size-10" />
            <p className="text-base font-semibold">Así se crea tu portal</p>
            <p className="text-sm text-white/85">Aquí verás una demo corta de cómo armar tu página, paso a paso.</p>
          </div>
        )}
        {/* Degradado inferior en negro neutro: el texto se lee sobre cualquier cuadro sin teñir el video. */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-5 pt-24">
          <p className="flex items-center gap-2 text-base font-semibold">
            <Rocket className="size-4" />
            Tu portal listo en minutos
          </p>
          <p className="text-sm text-white/85">Elige, personaliza y publica. Sin código.</p>
        </div>
      </aside>

      <aside className="flex h-full w-64 flex-col overflow-hidden rounded-none border-l border-border bg-background">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Lightbulb className="size-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">Consejos para tu página</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden p-5">
          <section className="flex min-h-0 flex-1 flex-col gap-3">
            <CustomizeArt />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Lo más importante</p>
              <p className="mt-1 text-base font-semibold leading-snug text-foreground">{FEATURED_TIP.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{FEATURED_TIP.text}</p>
            </div>
          </section>

          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {TIPS.map(({ art: Art, title, text }) => (
              <li key={title} className="flex items-start gap-3 py-3.5">
                <span className="size-12 shrink-0 overflow-hidden rounded-md border border-border">
                  <Art />
                </span>
                <span className="text-[13px] leading-snug text-muted-foreground">
                  <span className="block font-medium text-foreground">{title}</span>
                  {text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
