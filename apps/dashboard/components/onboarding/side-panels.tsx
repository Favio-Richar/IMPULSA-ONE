"use client";

import { ChartNoAxesColumn, Clapperboard, LayoutTemplate, Lightbulb, MousePointerClick, Palette, Rocket, Share2 } from "lucide-react";
import { useSyncExternalStore } from "react";

/**
 * Contenido de los paneles laterales del asistente. Sin marcas ni logos de terceros (ADR-008).
 * El video actual es un clip de stock de Pexels (licencia Pexels: uso comercial sin atribución; autor Mizuno K, id 13736547,
 * `public/onboarding/demo-portal.mp4`), temporal. Para reemplazarlo, sube el archivo a `apps/dashboard/public/onboarding/` y
 * cambia aquí la ruta. Con `null` se muestra un marcador con texto.
 */
export const ONBOARDING_PROMO: { videoUrl: string | null; posterUrl: string | null } = {
  videoUrl: "/onboarding/demo-portal.mp4",
  posterUrl: null,
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

const TIPS: ReadonlyArray<{ icon: typeof Lightbulb; title: string; text: string }> = [
  { icon: Palette, title: "Todo se puede cambiar", text: "Colores, fuentes y bloques se editan después sin perder tu contenido." },
  { icon: MousePointerClick, title: "Un botón principal", text: "Una sola acción destacada convierte mejor que muchas a la vez." },
  { icon: Share2, title: "Compártela donde estés", text: "Tu dirección y tu QR sirven en redes, tarjetas y mensajes." },
  { icon: LayoutTemplate, title: "Tu rubro ordena las plantillas", text: "Te mostramos primero las que mejor encajan con lo que haces." },
  { icon: ChartNoAxesColumn, title: "Mide lo que pasa", text: "Desde el panel ves las visitas y los clics de tu página." },
];

/**
 * Paneles decorativos a los costados del asistente, solo en pantallas muy anchas. Ocupan todo el alto bajo el encabezado
 * (fijos: no se desplazan con la página). Son puramente visuales (`aria-hidden`, sin foco ni clics): el flujo del paso no
 * depende de ellos. En pantallas angostas no se renderizan, y el video ni se pide.
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
      className="pointer-events-none fixed inset-x-0 bottom-0 top-14 z-0 hidden justify-between gap-6 px-6 py-6 min-[1700px]:flex"
    >
      <aside className="relative h-full w-64 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/90 via-primary/70 to-primary/40 text-primary-foreground shadow-xl shadow-primary/10">
        {videoUrl ? (
          <video
            className="absolute inset-0 size-full object-cover"
            src={videoUrl}
            poster={posterUrl ?? undefined}
            muted
            loop
            playsInline
            autoPlay={!reducedMotion}
            preload="metadata"
            tabIndex={-1}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Clapperboard className="size-10" />
            <p className="text-base font-semibold">Así se crea tu portal</p>
            <p className="text-sm opacity-90">Aquí verás una demo corta de cómo armar tu página, paso a paso.</p>
          </div>
        )}
        {/* Degradado inferior: el texto se lee sobre cualquier video. */}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-5 pt-24 text-white">
          <p className="flex items-center gap-2 text-base font-semibold">
            <Rocket className="size-4" />
            Tu portal listo en minutos
          </p>
          <p className="text-sm text-white/85">Elige, personaliza y publica. Sin código.</p>
        </div>
      </aside>

      <aside className="flex h-full w-64 flex-col rounded-3xl border border-border bg-background/70 p-5 shadow-xl shadow-primary/10 backdrop-blur">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Lightbulb className="size-4 text-primary" />
          Consejos
        </p>
        <ul className="mt-4 flex flex-1 flex-col justify-between gap-3">
          {TIPS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex flex-1 items-center gap-3 rounded-2xl border border-border/70 bg-surface/60 p-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <span className="text-sm text-muted-foreground">
                <span className="block font-medium text-foreground">{title}</span>
                {text}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
