import type { CSSProperties } from "react";
import type { MarqueeBlockConfig } from "@impulza/validation";

/** Segundos que tarda cada palabra en cruzar: la duración total crece con la cantidad de textos, así la velocidad se siente igual. */
const SECONDS_PER_ITEM: Record<MarqueeBlockConfig["speed"], number> = { slow: 7, normal: 4.5, fast: 2.5 };

/**
 * Cinta de texto en movimiento (F10). Solo CSS: dos copias del mismo texto desplazándose (bucle sin saltos), sin
 * JavaScript. La segunda copia es decorativa (`aria-hidden`): el lector de pantalla lee el texto una sola vez. Con
 * «reducir movimiento» no se anima y el texto queda en una fila que se parte en varias líneas (ver `styles/site.css`).
 */
export function MarqueeBlock({ config }: { config: MarqueeBlockConfig }) {
  // Pocos textos no llenarían el ancho de una pantalla y dejarían un hueco al desplazarse: se repiten hasta tener al menos 6.
  const repeats = Math.max(1, Math.ceil(6 / config.items.length));
  const looped = Array.from({ length: repeats }, () => config.items).flat();
  const duration = Math.max(14, looped.length * SECONDS_PER_ITEM[config.speed]);
  const track = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="site-marquee-track flex shrink-0 items-center" role={hidden ? "presentation" : undefined}>
      {looped.map((text, index) => (
        <li key={index} className="flex shrink-0 items-center whitespace-nowrap">
          <span className="px-6 text-2xl font-semibold uppercase tracking-[0.18em] sm:text-3xl" style={{ fontFamily: "var(--site-font-heading)" }}>
            {text}
          </span>
          <span aria-hidden="true" className="text-[var(--site-color-muted-foreground)]">
            ✦
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className="site-marquee relative flex overflow-hidden border-y border-[var(--site-color-border)] py-4 text-[var(--site-color-foreground)]"
      style={{ "--site-marquee-duration": `${duration}s` } as CSSProperties}
    >
      {track(false)}
      {track(true)}
    </div>
  );
}
