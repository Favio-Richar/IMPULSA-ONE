import { renderToStaticMarkup } from "react-dom/server";
import { countdownSchema, eventsSchema, mapSchema, musicSchema, pricingSchema, videoSchema } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { CountdownBlock, remainingSentence, remainingUntil } from "./countdown.js";
import { EventsBlock, eventsJsonLd, eventWhen, scheduleEvents } from "./events.js";
import { serializeJsonLd } from "../lib/json-ld.js";
import { MapBlock, mapLinks } from "./map.js";
import { MusicBlock } from "./music.js";
import { PricingBlock } from "./pricing.js";
import { VideoBlock } from "./video.js";

// F7.3 (ADR-018): lo que el servidor pinta de cada bloque nuevo. Los iframes salen solo de
// plantillas fijas; lo que depende del momento (conteo, eventos pasados) se decide en el navegador.

describe("cuenta regresiva", () => {
  const config = countdownSchema.parse({ title: "Lanzamiento", target: "2031-10-12T20:00", timeZone: "America/Santiago", cta: { label: "Avísame", url: "https://ejemplo.cl" } });

  it("el servidor pinta la fecha escrita y las cifras en blanco (sin desajuste al hidratar)", () => {
    const html = renderToStaticMarkup(<CountdownBlock config={config} buttonVariant="primary" />);
    expect(html).toContain("Lanzamiento");
    expect(html).toContain("domingo, 12 de octubre, 20:00");
    expect(html).toContain("hora de Chile (Santiago)");
    expect(html).toContain('role="timer"');
    expect(html.match(/data-countdown-value="[a-z]+">–</g)).toHaveLength(4);
    expect(html).toContain('href="https://ejemplo.cl"');
  });

  it("calcula lo que falta y lo dice en una frase para el lector de pantalla", () => {
    const target = Date.UTC(2031, 0, 2, 3, 4, 5);
    expect(remainingUntil(target, Date.UTC(2031, 0, 1))).toEqual({ days: 1, hours: 3, minutes: 4, seconds: 5 });
    expect(remainingUntil(target, target + 10_000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(remainingSentence({ days: 1, hours: 3, minutes: 4, seconds: 5 })).toBe("1 día, 3 horas y 4 minutos");
    expect(remainingSentence({ days: 0, hours: 0, minutes: 1, seconds: 0 })).toBe("1 minuto");
  });
});

describe("tabla de precios", () => {
  it("formatea montos enteros por moneda, marca el destacado y lee el periodo", () => {
    const config = pricingSchema.parse({
      title: "Planes",
      plans: [
        { name: "Básico", priceAmount: 12990, period: "month", features: ["1 sesión"] },
        { name: "Pro", priceAmount: 1999, priceCurrency: "USD", period: "year", highlighted: true, badge: "Popular", cta: { label: "Elegir", url: "https://ejemplo.cl/pro" } },
      ],
    });
    const html = renderToStaticMarkup(<PricingBlock config={config} buttonVariant="primary" />);
    expect(html).toContain("$12.990");
    expect(html).toContain("US$19,99");
    expect(html).toContain("al mes");
    expect(html).toContain("al año");
    expect(html.match(/data-highlighted/g)).toHaveLength(1);
    expect(html).toContain("Popular");
    expect(html).toContain('href="https://ejemplo.cl/pro"');
  });
});

describe("mapa", () => {
  it("no carga Google al abrir la página: tarjeta propia, cómo llegar y botón para ver el mapa", () => {
    const html = renderToStaticMarkup(<MapBlock config={mapSchema.parse({ name: "Estudio", address: "Av. Providencia 1234, Santiago" })} />);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("<address");
    expect(html).toContain("Ver mapa");
    expect(html).toContain(`href="${mapLinks("Av. Providencia 1234, Santiago").googleDirections.replace(/&/g, "&amp;")}"`);
  });

  it("la dirección siempre viaja codificada: no puede cambiar el destino ni agregar parámetros", () => {
    const links = mapLinks('Calle 1 & q=evil"><script>');
    expect(new URL(links.embed).hostname).toBe("www.google.com");
    expect(new URL(links.embed).searchParams.get("q")).toBe('Calle 1 & q=evil"><script>');
    expect(new URL(links.waze).hostname).toBe("waze.com");
  });

  it("sin mapa, solo quedan los enlaces para llegar", () => {
    expect(renderToStaticMarkup(<MapBlock config={mapSchema.parse({ address: "Calle 1", showMap: false })} />)).not.toContain("Ver mapa");
  });
});

describe("música y video", () => {
  it("el reproductor sale de la plantilla del proveedor, con sandbox y un enlace para escuchar afuera", () => {
    const html = renderToStaticMarkup(<MusicBlock config={musicSchema.parse({ music: "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3", title: "Mi disco" })} />);
    expect(html).toContain('src="https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3?utm_source=generator"');
    expect(html).toContain('sandbox="');
    expect(html).toContain('title="Mi disco (Spotify)"');
    expect(html).toContain('height="352"');
    expect(html).toContain("Escuchar en Spotify");
  });

  it("TikTok y Shorts se ven verticales; YouTube normal sigue horizontal", () => {
    const tiktok = renderToStaticMarkup(<VideoBlock config={videoSchema.parse({ video: "https://www.tiktok.com/@ana/video/7312345678901234567" })} />);
    expect(tiktok).toContain("https://www.tiktok.com/player/v1/7312345678901234567");
    expect(tiktok).toContain("aspect-[9/16]");
    const youtube = renderToStaticMarkup(<VideoBlock config={videoSchema.parse({ video: "https://youtu.be/dQw4w9WgXcQ" })} />);
    expect(youtube).toContain("aspect-video");
  });
});

describe("eventos", () => {
  const config = eventsSchema.parse({
    title: "Próximas fechas",
    timeZone: "America/Santiago",
    items: [
      { name: "Concierto de cierre", start: "2031-12-20T21:00", end: "2031-12-20T23:30", venue: "Teatro Caupolicán", ticketUrl: "https://entradas.cl/x" },
      { name: "Taller", start: "2031-11-05T10:00", soldOut: true, ticketUrl: "https://entradas.cl/y" },
    ],
  });

  it("los ordena por fecha, con su horario en la zona del negocio", () => {
    const events = scheduleEvents(config);
    expect(events.map((event) => event.item.name)).toEqual(["Taller", "Concierto de cierre"]);
    expect(eventWhen(events[1]!, "America/Santiago")).toBe("sábado, 20 de diciembre, 21:00 – 23:30");
    // Sin término: dos horas para el calendario, pero la página muestra solo el inicio.
    expect(events[0]!.end.getTime() - events[0]!.start.getTime()).toBe(2 * 3_600_000);
    expect(eventWhen(events[0]!, "America/Santiago")).toBe("miércoles, 5 de noviembre, 10:00");
  });

  it("cada evento trae su .ics y sus entradas; uno agotado no enlaza a la venta", () => {
    const html = renderToStaticMarkup(<EventsBlock config={config} />);
    expect(html.indexOf("Taller")).toBeLessThan(html.indexOf("Concierto de cierre"));
    expect(html.match(/href="data:text\/calendar/g)).toHaveLength(2);
    expect(html).toContain('download="concierto-de-cierre.ics"');
    expect(html).toContain('href="https://entradas.cl/x"');
    expect(html).not.toContain('href="https://entradas.cl/y"');
    expect(html).toContain("Agotado");
    // El .ics lleva la hora en UTC: 21:00 de Santiago en diciembre (UTC-3) = 00:00 UTC del día siguiente.
    expect(decodeURIComponent(html)).toContain("DTSTART:20311221T000000Z");
  });

  it("publica los eventos para buscadores (schema.org) sin que un nombre pueda cerrar la etiqueta", () => {
    const data = eventsJsonLd(config);
    expect(data[1]).toMatchObject({
      "@type": "Event",
      name: "Concierto de cierre",
      startDate: "2031-12-21T00:00:00.000Z",
      location: { "@type": "Place", name: "Teatro Caupolicán" },
      offers: { url: "https://entradas.cl/x", availability: "https://schema.org/InStock" },
    });
    expect(data[0]).toMatchObject({ offers: { availability: "https://schema.org/SoldOut" } });
    const hostile = serializeJsonLd({ name: "</script><script>alert(1)</script> &  " });
    expect(hostile).not.toContain("</script>");
    expect(hostile).not.toContain("<");
    expect(JSON.parse(hostile)).toEqual({ name: "</script><script>alert(1)</script> &  " });
    const html = renderToStaticMarkup(<EventsBlock config={eventsSchema.parse({ timeZone: "America/Santiago", items: [{ name: "</script><b>x", start: "2031-01-01T20:00" }] })} />);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});
