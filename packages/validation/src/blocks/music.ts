import { z } from "zod";
import { embedFromUrlSchema } from "./primitives.js";

// Música incrustada (F7.3, ADR-018). Misma regla que el video (F2.4): el negocio pega el enlace
// normal de la canción; se guarda solo `{proveedor, tipo, id}` validado por lista blanca de
// caracteres, y el render arma el `src` desde una plantilla fija. Nunca un código de inserción ni
// una URL de iframe escrita por el usuario.

export const MUSIC_PROVIDERS = ["spotify", "soundcloud", "applemusic"] as const;
export type MusicProvider = (typeof MUSIC_PROVIDERS)[number];

export const MUSIC_PROVIDER_LABELS: Record<MusicProvider, string> = {
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  applemusic: "Apple Music",
};

const SPOTIFY_KINDS = ["track", "album", "playlist", "artist", "episode", "show"] as const;
const APPLE_KINDS = ["song", "album", "playlist"] as const;

const spotifySchema = z.object({
  provider: z.literal("spotify"),
  kind: z.enum(SPOTIFY_KINDS),
  id: z.string().regex(/^[A-Za-z0-9]{22}$/),
});

/** SoundCloud no expone un id en su enlace público: se guarda la ruta (`artista`, `artista/tema`, `artista/sets/lista`). */
const SOUNDCLOUD_PATH = /^[a-z0-9_-]{1,100}(?:\/(?:sets\/)?[a-z0-9_-]{1,200})?$/;
const soundcloudSchema = z.object({
  provider: z.literal("soundcloud"),
  path: z.string().regex(SOUNDCLOUD_PATH),
});

const appleSchema = z.object({
  provider: z.literal("applemusic"),
  country: z.string().regex(/^[a-z]{2}$/),
  kind: z.enum(APPLE_KINDS),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{1,200}$/)
    .optional(),
  id: z.string().regex(/^(?:\d{1,15}|pl\.[A-Za-z0-9-]{10,64})$/),
  trackId: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
});

/** Forma **guardada** de la música: proveedor de la lista blanca y sus ids, nunca una URL. */
export const storedMusicSchema = z.discriminatedUnion("provider", [spotifySchema, soundcloudSchema, appleSchema]);
export type StoredMusic = z.infer<typeof storedMusicSchema>;

const SOUNDCLOUD_RESERVED = new Set(["discover", "search", "stream", "upload", "you", "charts", "pages", "settings", "messages", "notifications", "people", "tags", "terms-of-use", "mobile"]);

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Reconoce un enlace de Spotify, SoundCloud o Apple Music, o `null` si no es de uno de ellos. */
export function parseMusicUrl(value: string): StoredMusic | null {
  const url = parseUrl(value.trim());
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "open.spotify.com") {
    // open.spotify.com/intl-es/track/<id>, open.spotify.com/embed/album/<id>
    const rest = segments.filter((segment, index) => !(index === 0 && (segment.startsWith("intl-") || segment === "embed")));
    const [kind, id] = rest;
    const parsed = spotifySchema.safeParse({ provider: "spotify", kind, id });
    return parsed.success ? parsed.data : null;
  }

  if (host === "soundcloud.com" || host === "www.soundcloud.com" || host === "m.soundcloud.com") {
    const lower = segments.map((segment) => segment.toLowerCase());
    if (lower.length === 0 || lower.length > 3 || SOUNDCLOUD_RESERVED.has(lower[0]!)) return null;
    if (lower.length === 3 && lower[1] !== "sets") return null;
    const path = lower.join("/");
    return SOUNDCLOUD_PATH.test(path) ? { provider: "soundcloud", path } : null;
  }

  if (host === "music.apple.com" || host === "embed.music.apple.com") {
    // music.apple.com/<país>/<album|playlist|song>/<nombre>/<id>?i=<tema>
    const [country, kind, ...rest] = segments;
    if (!country || !kind) return null;
    const id = rest.at(-1);
    const slug = rest.length === 2 ? rest[0]!.toLowerCase() : undefined;
    const trackId = url.searchParams.get("i") ?? undefined;
    const parsed = appleSchema.safeParse({ provider: "applemusic", country: country.toLowerCase(), kind, slug, id, trackId });
    // Un nombre con caracteres fuera de la lista (tildes, emojis) no hace falta: el id basta.
    if (!parsed.success && slug) {
      const withoutSlug = appleSchema.safeParse({ provider: "applemusic", country: country.toLowerCase(), kind, id, trackId });
      return withoutSlug.success ? withoutSlug.data : null;
    }
    return parsed.success ? parsed.data : null;
  }

  return null;
}

/**
 * Acepta el enlace que pega el usuario (y lo normaliza) **o** la forma ya guardada: el mismo
 * esquema valida lo que entra y relee lo guardado (ver `videoEmbedSchema`).
 */
export const musicEmbedSchema = embedFromUrlSchema(storedMusicSchema, parseMusicUrl, {
  empty: "Pega el enlace de la canción, el álbum o la lista.",
  unknown: "Solo se admiten enlaces de Spotify, SoundCloud o Apple Music. Usa «Compartir → Copiar enlace».",
});

/** `src` del reproductor, desde una plantilla fija por proveedor. */
export function musicEmbedSrc(music: StoredMusic): string {
  switch (music.provider) {
    case "spotify":
      return `https://open.spotify.com/embed/${music.kind}/${music.id}?utm_source=generator`;
    case "soundcloud": {
      const target = encodeURIComponent(`https://soundcloud.com/${music.path}`);
      return `https://w.soundcloud.com/player/?url=${target}&color=%23333333&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false`;
    }
    case "applemusic": {
      const slug = music.slug ? `${music.slug}/` : "";
      const track = music.trackId ? `?i=${music.trackId}` : "";
      return `https://embed.music.apple.com/${music.country}/${music.kind}/${slug}${music.id}${track}`;
    }
  }
}

/** Enlace público equivalente (para editar un bloque guardado y para "Abrir en…"). */
export function musicPublicUrl(music: StoredMusic): string {
  switch (music.provider) {
    case "spotify":
      return `https://open.spotify.com/${music.kind}/${music.id}`;
    case "soundcloud":
      return `https://soundcloud.com/${music.path}`;
    case "applemusic": {
      const slug = music.slug ? `${music.slug}/` : "";
      const track = music.trackId ? `?i=${music.trackId}` : "";
      return `https://music.apple.com/${music.country}/${music.kind}/${slug}${music.id}${track}`;
    }
  }
}

/** Alto del reproductor: compacto para un tema, más alto para listas y álbumes. */
export function musicEmbedHeight(music: StoredMusic): number {
  const single =
    (music.provider === "spotify" && (music.kind === "track" || music.kind === "episode")) ||
    (music.provider === "soundcloud" && music.path.split("/").length === 2) ||
    (music.provider === "applemusic" && (music.kind === "song" || music.trackId !== undefined));
  if (music.provider === "soundcloud") return single ? 166 : 450;
  if (music.provider === "applemusic") return single ? 175 : 450;
  return single ? 152 : 352;
}
