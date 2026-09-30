import { describe, expect, it } from "vitest";
import { countdownSchema, eventsSchema, mapSchema, musicSchema, pricingSchema, videoSchema } from "./catalog.js";
import { musicEmbedHeight, musicEmbedSrc, musicPublicUrl, parseMusicUrl } from "./music.js";
import { parseVideoUrl } from "./primitives.js";
import { formatLocalDateTime, localDateTimeToInstant } from "./time.js";

// F7.3 (ADR-018): bloques nuevos. Lo importante: los enlaces externos se reconocen por plantilla y
// nunca se acepta código de inserción; las fechas se guardan en hora de pared + zona.

describe("música: solo enlaces reconocidos, guardados como proveedor + id", () => {
  it("Spotify: tema, álbum, lista y artista, también con intl- y embed", () => {
    expect(parseMusicUrl("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc")).toEqual({ provider: "spotify", kind: "track", id: "4uLU6hMCjMI75M1A2tKUQC" });
    expect(parseMusicUrl("https://open.spotify.com/intl-es/album/1DFixLWuPkv3KT3TnV35m3")).toMatchObject({ kind: "album" });
    expect(parseMusicUrl("https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M")).toMatchObject({ kind: "playlist" });
    expect(parseMusicUrl("https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF")).toMatchObject({ kind: "artist" });
    expect(parseMusicUrl("https://open.spotify.com/user/abc")).toBeNull();
    expect(parseMusicUrl("https://open.spotify.com/track/corto")).toBeNull();
  });

  it("SoundCloud: artista, tema y lista por su ruta; rutas del sitio no", () => {
    expect(parseMusicUrl("https://soundcloud.com/Artista-Uno/mi-tema?in=x")).toEqual({ provider: "soundcloud", path: "artista-uno/mi-tema" });
    expect(parseMusicUrl("https://m.soundcloud.com/artista/sets/lista")).toEqual({ provider: "soundcloud", path: "artista/sets/lista" });
    expect(parseMusicUrl("https://soundcloud.com/artista")).toEqual({ provider: "soundcloud", path: "artista" });
    expect(parseMusicUrl("https://soundcloud.com/discover")).toBeNull();
    expect(parseMusicUrl("https://soundcloud.com/a/b/c")).toBeNull();
  });

  it("Apple Music: con o sin nombre, con tema dentro del álbum, y listas", () => {
    expect(parseMusicUrl("https://music.apple.com/cl/album/un-verano-sin-ti/1622045624?i=1622045628")).toEqual({
      provider: "applemusic",
      country: "cl",
      kind: "album",
      slug: "un-verano-sin-ti",
      id: "1622045624",
      trackId: "1622045628",
    });
    expect(parseMusicUrl("https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb")).toMatchObject({
      kind: "playlist",
      id: "pl.f4d106fed2bd41149aaacabb233eb5eb",
    });
    // Nombre con tildes (fuera de la lista blanca): se guarda sin él.
    expect(parseMusicUrl("https://music.apple.com/cl/album/canción-ñ/1622045624")).toEqual({ provider: "applemusic", country: "cl", kind: "album", id: "1622045624" });
    expect(parseMusicUrl("https://music.apple.com/cl/artist/x/123")).toBeNull();
  });

  it("rechaza otros sitios, esquemas raros y el código de inserción, con un mensaje claro", () => {
    for (const bad of ["https://evil.example.com/track/4uLU6hMCjMI75M1A2tKUQC", "javascript:alert(1)", "https://open.spotify.com.evil.com/track/4uLU6hMCjMI75M1A2tKUQC"]) {
      expect(musicSchema.safeParse({ music: bad }).success, bad).toBe(false);
    }
    const iframe = musicSchema.safeParse({ music: "<iframe src=\"https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC\"></iframe>" });
    expect(iframe.success).toBe(false);
    expect(iframe.error?.issues[0]?.message).toContain("no el código de inserción");
    // La forma guardada no admite ids con otros caracteres.
    expect(musicSchema.safeParse({ music: { provider: "spotify", kind: "track", id: "../../evil" } }).success).toBe(false);
    expect(musicSchema.safeParse({ music: { provider: "soundcloud", path: "a/b?x=<script>" } }).success).toBe(false);
  });

  it("el reproductor sale siempre de una plantilla fija, y el enlace vuelve a leerse igual", () => {
    const samples = [
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      "https://soundcloud.com/artista/sets/lista",
      "https://music.apple.com/cl/album/un-verano-sin-ti/1622045624?i=1622045628",
    ];
    for (const sample of samples) {
      const music = parseMusicUrl(sample)!;
      expect(parseMusicUrl(musicPublicUrl(music))).toEqual(music);
      const src = new URL(musicEmbedSrc(music));
      expect(["open.spotify.com", "w.soundcloud.com", "embed.music.apple.com"]).toContain(src.hostname);
    }
    expect(musicEmbedSrc(parseMusicUrl(samples[1]!)!)).toContain(encodeURIComponent("https://soundcloud.com/artista/sets/lista"));
    expect(musicEmbedHeight(parseMusicUrl(samples[0]!)!)).toBe(152);
    expect(musicEmbedHeight(parseMusicUrl("https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3")!)).toBe(352);
  });
});

describe("video: TikTok y verticales", () => {
  it("TikTok con su id completo, y Shorts de YouTube, van verticales", () => {
    expect(parseVideoUrl("https://www.tiktok.com/@ana/video/7312345678901234567?lang=es")).toEqual({ provider: "tiktok", videoId: "7312345678901234567", vertical: true });
    expect(parseVideoUrl("https://www.tiktok.com/embed/v2/7312345678901234567")).toMatchObject({ provider: "tiktok" });
    expect(parseVideoUrl("https://vm.tiktok.com/ZMabc123/")).toBeNull();
    expect(parseVideoUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ", vertical: true });
    expect(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
  });

  it("un video guardado antes (sin `vertical`) se sigue leyendo igual", () => {
    expect(videoSchema.parse({ video: { provider: "youtube", videoId: "dQw4w9WgXcQ" } })).toEqual({ video: { provider: "youtube", videoId: "dQw4w9WgXcQ" } });
  });
});

describe("fecha y hora de pared con zona", () => {
  it("convierte respetando el horario de Chile y detecta horas que no existen", () => {
    // Invierno en Chile (UTC-4) y verano (UTC-3).
    expect(localDateTimeToInstant("2026-07-01T20:00", "America/Santiago")?.toISOString()).toBe("2026-07-02T00:00:00.000Z");
    expect(localDateTimeToInstant("2026-12-01T20:00", "America/Santiago")?.toISOString()).toBe("2026-12-01T23:00:00.000Z");
    // 6 de septiembre de 2026: el reloj salta de 00:00 a 01:00.
    expect(localDateTimeToInstant("2026-09-06T00:30", "America/Santiago")).toBeNull();
    expect(formatLocalDateTime("2026-10-12T20:00", "America/Santiago", { weekday: true })).toMatch(/lunes, 12 de octubre.*20:00/);
  });

  it("la cuenta regresiva rechaza fechas imposibles, horas inexistentes y zonas inventadas", () => {
    expect(countdownSchema.safeParse({ target: "2026-02-30T10:00", timeZone: "America/Santiago" }).success).toBe(false);
    expect(countdownSchema.safeParse({ target: "2026-10-12 20:00", timeZone: "America/Santiago" }).success).toBe(false);
    expect(countdownSchema.safeParse({ target: "2026-10-12T20:00", timeZone: "Marte/Olympus" }).success).toBe(false);
    const gap = countdownSchema.safeParse({ target: "2026-09-06T00:30", timeZone: "America/Santiago" });
    expect(gap.success).toBe(false);
    expect(gap.error?.issues[0]?.path).toEqual(["target"]);
    expect(countdownSchema.parse({ target: "2026-10-12T20:00", timeZone: "America/Santiago" })).toMatchObject({ endedBehavior: "message" });
  });

  it("eventos: el término va después del inicio, con el error en el campo exacto", () => {
    const bad = eventsSchema.safeParse({ timeZone: "America/Santiago", items: [{ name: "A", start: "2031-01-01T20:00", end: "2031-01-01T19:00" }] });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["items", 0, "end"]);
    expect(eventsSchema.safeParse({ timeZone: "America/Santiago", items: [] }).success).toBe(false);
    expect(eventsSchema.safeParse({ timeZone: "America/Santiago", items: Array.from({ length: 21 }, () => ({ name: "A", start: "2031-01-01T20:00" })) }).success).toBe(false);
    expect(eventsSchema.safeParse({ timeZone: "America/Santiago", items: [{ name: "A", start: "2031-01-01T20:00", ticketUrl: "javascript:alert(1)" }] }).success).toBe(false);
  });
});

describe("precios y mapa", () => {
  it("precios: montos enteros, hasta 4 planes, un solo destacado y botón seguro", () => {
    const plan = { name: "Plan", priceAmount: 9990 };
    expect(pricingSchema.parse({ plans: [plan] }).plans[0]).toMatchObject({ priceCurrency: "CLP", period: "once", features: [], highlighted: false });
    expect(pricingSchema.safeParse({ plans: [{ ...plan, priceAmount: 99.9 }] }).success).toBe(false);
    expect(pricingSchema.safeParse({ plans: Array.from({ length: 5 }, () => plan) }).success).toBe(false);
    expect(pricingSchema.safeParse({ plans: [{ ...plan, highlighted: true }, { ...plan, highlighted: true }] }).success).toBe(false);
    expect(pricingSchema.safeParse({ plans: [{ ...plan, cta: { label: "Ir", url: "javascript:alert(1)" } }] }).success).toBe(false);
    expect(pricingSchema.safeParse({ plans: [{ ...plan, features: Array.from({ length: 13 }, () => "x") }] }).success).toBe(false);
  });

  it("mapa: una dirección de texto, sin coordenadas ni URL", () => {
    expect(mapSchema.parse({ address: "Av. Providencia 1234" })).toEqual({ address: "Av. Providencia 1234", showMap: true });
    expect(mapSchema.safeParse({ address: "  " }).success).toBe(false);
  });
});
