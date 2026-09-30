"use client";

import { CalendarPlus, MapPin, Ticket } from "lucide-react";
import { localDateTimeToInstant, type EventItem, type EventsBlockConfig } from "@impulza/validation";
import { useMemo } from "react";
import { buildIcs } from "../lib/ics.js";
import { serializeJsonLd } from "../lib/json-ld.js";
import { useNow } from "../lib/clock.js";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { SiteImage } from "../ui/site-image.js";
import { stackSurfaceClass } from "../ui/stack-button.js";
import { zoneLabel } from "./countdown.js";

const DEFAULT_DURATION_MS = 2 * 3_600_000;

export interface ScheduledEvent {
  item: EventItem;
  start: Date;
  end: Date;
  index: number;
}

/** Eventos con su instante de inicio y término, ordenados por inicio. Los de hora inválida se omiten. */
export function scheduleEvents(config: EventsBlockConfig): ScheduledEvent[] {
  return config.items
    .map((item, index) => {
      const start = localDateTimeToInstant(item.start, config.timeZone);
      if (!start) return null;
      const end = (item.end ? localDateTimeToInstant(item.end, config.timeZone) : null) ?? new Date(start.getTime() + DEFAULT_DURATION_MS);
      return { item, start, end, index };
    })
    .filter((event): event is ScheduledEvent => event !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Datos estructurados de schema.org para las fechas del bloque (F7.3): Google puede mostrarlas como
 * resultados enriquecidos. Incluye todas las fechas guardadas (el servidor no sabe cuándo se mira
 * una página cacheada; Google ignora las pasadas).
 */
export function eventsJsonLd(config: EventsBlockConfig): Record<string, unknown>[] {
  return scheduleEvents(config).map(({ item, start, end }) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name: item.name,
    startDate: start.toISOString(),
    ...(item.end ? { endDate: end.toISOString() } : {}),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(item.venue || item.address
      ? { location: { "@type": "Place", ...(item.venue ? { name: item.venue } : {}), ...(item.address ? { address: item.address } : {}) } }
      : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.image ? { image: [item.image.url] } : {}),
    ...(item.ticketUrl
      ? { offers: { "@type": "Offer", url: item.ticketUrl, availability: item.soldOut ? "https://schema.org/SoldOut" : "https://schema.org/InStock" } }
      : {}),
  }));
}

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("es-CL", { timeZone, ...options });
}

/** "sábado 12 de octubre, 20:00 – 23:00" (o con la fecha de término si es otro día). */
export function eventWhen(event: ScheduledEvent, timeZone: string): string {
  const day = formatter(timeZone, { weekday: "long", day: "numeric", month: "long" });
  const time = formatter(timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const sameDay = day.format(event.start) === day.format(event.end);
  const start = `${day.format(event.start)}, ${time.format(event.start)}`;
  if (!event.item.end) return start;
  return sameDay ? `${start} – ${time.format(event.end)}` : `${start} – ${day.format(event.end)}, ${time.format(event.end)}`;
}

/**
 * Próximas fechas (F7.3, ADR-018). El servidor pinta todas, ordenadas; al hidratar, el navegador
 * quita las que ya terminaron (la página puede estar cacheada) y, si no queda ninguna, el bloque
 * desaparece. Cada una ofrece su archivo de calendario (.ics) y, si tiene, el enlace de entradas.
 */
export function EventsBlock({ config, glass = false }: { config: EventsBlockConfig; glass?: boolean }) {
  const now = useNow(60_000);
  const all = useMemo(() => scheduleEvents(config), [config]);
  const upcoming = now === null ? all : all.filter((event) => event.end.getTime() > now);
  if (upcoming.length === 0) return null;
  const surface = stackSurfaceClass(glass ? "glass" : "secondary");

  return (
    <section className="flex flex-col gap-3" aria-label={config.title ?? "Próximos eventos"} data-events="">
      {config.title ? <h2 className="text-center text-base font-semibold text-[var(--site-color-foreground)]">{config.title}</h2> : null}
      <ol className="flex flex-col gap-3">
        {upcoming.map((event) => (
          <EventCard key={event.index} event={event} timeZone={config.timeZone} surface={surface} />
        ))}
      </ol>
      <p className="text-center text-xs text-[var(--site-color-muted-foreground)]">Horarios en hora de {zoneLabel(config.timeZone)}.</p>
      {/* schema.org para buscadores (texto del negocio escapado: nunca cierra la etiqueta). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(eventsJsonLd(config)) }} />
    </section>
  );
}

function EventCard({ event, timeZone, surface }: { event: ScheduledEvent; timeZone: string; surface: string }) {
  const { item } = event;
  const month = formatter(timeZone, { month: "short" }).format(event.start).replace(".", "");
  const day = formatter(timeZone, { day: "numeric" }).format(event.start);
  const place = [item.venue, item.address].filter(Boolean).join(" · ");
  // Sello de tiempo fijo (el inicio): el `href` sale igual en el servidor y en el navegador.
  const icsHref = useMemo(() => {
    const ics = buildIcs({
      uid: `${event.start.toISOString()}-${event.index}@impulza`,
      title: item.name,
      start: event.start,
      end: event.end,
      description: [place, item.description].filter(Boolean).join("\n") || undefined,
      url: item.ticketUrl,
      now: event.start,
    });
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  }, [event, item, place]);

  return (
    <li className={`flex flex-col overflow-hidden ${surface}`} data-event="">
      {item.image ? (
        <SiteImage image={item.image} sizes="(min-width: 640px) 560px, 100vw" width={1120} height={560} className="aspect-[2/1] w-full object-cover" />
      ) : null}
      <div className="flex gap-4 p-4">
        <div
          aria-hidden="true"
          className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-[calc(var(--site-radius)/1.5)] bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]"
        >
          <span className="text-xs font-semibold uppercase">{month}</span>
          <span className="text-2xl font-bold leading-none tabular-nums">{day}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-semibold text-[var(--site-color-foreground)]">{item.name}</h3>
          <p className="text-sm text-[var(--site-color-foreground)]">
            <time dateTime={event.start.toISOString()}>{eventWhen(event, timeZone)}</time>
          </p>
          {place ? (
            <p className="flex items-start gap-1.5 text-sm text-[var(--site-color-muted-foreground)]">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{place}</span>
            </p>
          ) : null}
          {item.description ? <p className="text-sm text-[var(--site-color-muted-foreground)]">{item.description}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {item.soldOut ? (
              <span className="inline-flex min-h-10 items-center rounded-[calc(var(--site-radius)/1.5)] border border-[var(--site-color-border)] px-3 text-sm font-semibold text-[var(--site-color-foreground)]">
                Agotado
              </span>
            ) : item.ticketUrl ? (
              <a
                href={item.ticketUrl}
                {...OUTBOUND_LINK}
                className="inline-flex min-h-10 items-center gap-2 rounded-[calc(var(--site-radius)/1.5)] bg-[var(--site-color-primary)] px-4 text-sm font-semibold text-[var(--site-color-primary-foreground)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <Ticket className="h-4 w-4" aria-hidden="true" />
                {item.ticketLabel ?? "Entradas"}
              </a>
            ) : null}
            <a
              href={icsHref}
              download={`${item.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "evento"}.ics`}
              className="inline-flex min-h-10 items-center gap-2 rounded-[calc(var(--site-radius)/1.5)] border border-[var(--site-color-border)] px-3 text-sm font-medium text-[var(--site-color-foreground)] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              Agregar a mi calendario
            </a>
          </div>
        </div>
      </div>
    </li>
  );
}
