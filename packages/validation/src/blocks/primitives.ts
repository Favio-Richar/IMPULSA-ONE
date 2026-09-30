import { z } from "zod";

// Piezas reutilizables de la configuración de los bloques (F2.4). Todo lo de acá es isomorfo
// (sin dependencias de Node): el constructor las usa para validar mientras se edita y la API las
// vuelve a aplicar al guardar — el cliente nunca es la autoridad (ST §15).

/**
 * Protocolos permitidos en cualquier enlace que termine en un `href` de la página pública.
 * `javascript:` y `data:` son ejecución de código disfrazada de enlace (XSS almacenado, que es
 * exactamente lo que evita la restricción de "nada de HTML/JS arbitrario" de ST §22).
 */
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:"]);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Enlace externo: solo http/https, nunca `javascript:`, `data:`, `vbscript:` ni relativos. */
export const safeUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .superRefine((value, ctx) => {
    const url = parseUrl(value);

    if (!url) {
      ctx.addIssue({ code: "custom", message: "Debe ser una URL absoluta válida (https://...)." });
      return;
    }

    if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) {
      ctx.addIssue({ code: "custom", message: "Solo se permiten enlaces http:// o https://." });
    }
  });

/** Texto plano: se guarda tal cual, sin interpretar como HTML en ningún render. */
export const plainTextSchema = (max: number) => z.string().trim().min(1).max(max);

/**
 * Texto enriquecido. Acá solo se valida el tamaño: la **sanitización con lista blanca de
 * etiquetas y atributos ocurre en el servidor** antes de persistir (ver `sanitizeBlockConfig` en
 * apps/api). Se deja fuera de este paquete a propósito para que siga siendo isomorfo y liviano —
 * el sanitizador es una dependencia de Node y no tiene por qué viajar al navegador.
 */
export const RICH_TEXT_MARKER = "richtext";

export const richTextSchema = z.string().max(20000).describe(RICH_TEXT_MARKER);

export const emailSchema = z.email().max(320);

/** Teléfono en formato E.164 (`+56912345678`): es lo que necesitan los enlaces `tel:` y WhatsApp. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Usa formato internacional, por ejemplo +56912345678.");

export const imageSchema = z.object({
  url: safeUrlSchema,
  // Obligatorio y no vacío: sin texto alternativo la página no cumple WCAG 2.2 AA, que es el
  // objetivo declarado del proyecto. Una imagen decorativa se marca con `decorative: true`.
  alt: z.string().trim().max(300),
  decorative: z.boolean().optional(),
});

export const IMAGE_ALT_REQUIRED_MESSAGE = "Describe la imagen o márcala como decorativa.";

/**
 * Rutas (`["background", "alt"]`, `["images", "2", "alt"]`) de las imágenes de una configuración de
 * bloque que no tienen texto alternativo ni están marcadas como decorativas (PP2).
 *
 * Es una regla **de escritura**, no parte de `imageSchema`: ese esquema también valida lo ya
 * guardado al renderizar (`parseStoredBlock`), y endurecerlo ahí dejaría de mostrar en la página
 * pública cualquier bloque antiguo con `alt` vacío. Al guardar, en cambio, se exige siempre — la API
 * lo rechaza y el panel lo marca junto al campo, con el mismo mensaje.
 */
export function findImagesWithoutAlt(config: unknown, path: string[] = []): string[][] {
  if (Array.isArray(config)) {
    return config.flatMap((item, index) => findImagesWithoutAlt(item, [...path, String(index)]));
  }
  if (!config || typeof config !== "object") {
    return [];
  }
  const obj = config as Record<string, unknown>;
  const isImage = typeof obj.url === "string" && obj.url.trim() !== "" && "alt" in obj;
  if (isImage) {
    const alt = typeof obj.alt === "string" ? obj.alt.trim() : "";
    return alt === "" && obj.decorative !== true ? [[...path, "alt"]] : [];
  }
  return Object.entries(obj).flatMap(([key, value]) => findImagesWithoutAlt(value, [...path, key]));
}

// --- Contenido incrustado por enlace -------------------------------------------------------

/**
 * Campo que acepta el **enlace** que pega el usuario (y lo normaliza con `parse`) o la forma ya
 * guardada (`stored`). Con `preprocess` y no con una unión: una unión de Zod resume sus errores en
 * "Invalid input" y el usuario no veía por qué se rechazaba su enlace (F7.3). El código de
 * inserción (`<iframe>`, `<script>`) se rechaza con su propio mensaje.
 */
export function embedFromUrlSchema<T extends z.ZodType>(
  stored: T,
  parse: (value: string) => z.infer<T> | null,
  messages: { empty: string; unknown: string },
) {
  return z.preprocess((value, ctx) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed === "") {
      ctx.addIssue({ code: "custom", message: messages.empty });
      return z.NEVER;
    }
    if (trimmed.length > 2048) {
      ctx.addIssue({ code: "custom", message: "El enlace es demasiado largo." });
      return z.NEVER;
    }
    if (/<\s*(?:iframe|script|embed|object)/i.test(trimmed)) {
      ctx.addIssue({ code: "custom", message: "Pega el enlace normal (Compartir → Copiar enlace), no el código de inserción." });
      return z.NEVER;
    }
    const parsed = parse(trimmed);
    if (!parsed) {
      ctx.addIssue({ code: "custom", message: messages.unknown });
      return z.NEVER;
    }
    return parsed;
  }, stored);
}

// --- Video embebido -------------------------------------------------------------------------

/**
 * Lista blanca de proveedores de video. No se guarda una URL de iframe libre: se guarda
 * `{provider, videoId}` y el render arma el `src` desde una plantilla fija. Así, aunque alguien
 * consiga escribir en la base de datos, no puede inyectar un iframe a un dominio arbitrario.
 */
export const VIDEO_PROVIDERS = ["youtube", "vimeo", "tiktok"] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);
const TIKTOK_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const TIKTOK_ID = /^\d{15,20}$/;

/**
 * Extrae `{provider, videoId}` de una URL de proveedor permitido, o `null` si no lo es. Los Shorts de
 * YouTube y los videos de TikTok llevan `vertical: true` (se ven 9:16, F7.3).
 */
export function parseVideoUrl(value: string): { provider: VideoProvider; videoId: string; vertical?: boolean } | null {
  const url = parseUrl(value);
  if (!url || !ALLOWED_LINK_PROTOCOLS.has(url.protocol)) {
    return null;
  }

  const host = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) {
    // youtu.be/<id>, youtube.com/watch?v=<id>, youtube.com/embed/<id>, /shorts/<id>
    const fromPath = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const candidate = host === "youtu.be" ? fromPath : (url.searchParams.get("v") ?? fromPath);
    if (!YOUTUBE_ID.test(candidate)) return null;
    return url.pathname.startsWith("/shorts/") ? { provider: "youtube", videoId: candidate, vertical: true } : { provider: "youtube", videoId: candidate };
  }

  if (VIMEO_HOSTS.has(host)) {
    const candidate = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return VIMEO_ID.test(candidate) ? { provider: "vimeo", videoId: candidate } : null;
  }

  if (TIKTOK_HOSTS.has(host)) {
    // tiktok.com/@usuaria/video/<id>, tiktok.com/embed/v2/<id>, tiktok.com/player/v1/<id>. Los
    // enlaces cortos (vm.tiktok.com) no traen el id: habría que seguir la redirección desde el
    // servidor, así que se piden completos.
    const segments = url.pathname.split("/").filter(Boolean);
    const index = segments.findIndex((segment) => segment === "video" || segment === "v2" || segment === "v1");
    const candidate = index >= 0 ? (segments[index + 1] ?? "") : "";
    return TIKTOK_ID.test(candidate) ? { provider: "tiktok", videoId: candidate, vertical: true } : null;
  }

  return null;
}

/** Forma en que el video queda **guardado**: proveedor de la lista blanca + id, nunca una URL. */
export const storedVideoSchema = z.object({
  provider: z.enum(VIDEO_PROVIDERS),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/),
  // F7.3: Shorts y TikTok. Opcional: un video guardado antes se lee igual (horizontal).
  vertical: z.boolean().optional(),
});

/**
 * Acepta la URL que pega el usuario y la normaliza a `{provider, videoId}`, **y también acepta esa
 * forma ya normalizada**.
 *
 * Lo segundo no es un adorno: el mismo esquema se usa para validar lo que entra y para releer lo
 * que está guardado (`parseStoredBlock`). Si solo aceptara la URL, todo bloque de video guardado
 * fallaría al releerse y el render público lo descartaría por "configuración inválida" — que es
 * exactamente el bug que encontró la prueba de ida y vuelta. La unión lo vuelve idempotente.
 */
export const videoEmbedSchema = embedFromUrlSchema(storedVideoSchema, parseVideoUrl, {
  empty: "Pega el enlace del video.",
  unknown: "Solo se permiten videos de YouTube, Vimeo o TikTok. Pega el enlace completo del video.",
});

// --- Redes sociales -------------------------------------------------------------------------

/**
 * También lista blanca: el render elige el icono por este valor, no por una URL cualquiera. Desde
 * PP8 cubre lo que una persona suele tener en su página de enlaces — redes, video y música,
 * creadores, portafolio, tiendas y agenda —, no solo las redes de un negocio. Agregar un valor es
 * compatible hacia atrás; quitar uno no (dejaría inválidos bloques guardados).
 */
export const SOCIAL_NETWORKS = [
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
  "linkedin",
  "x",
  "whatsapp",
  "threads",
  "pinterest",
  "spotify",
  "github",
  "website",
  "onlyfans",
  "twitch",
  "kick",
  "telegram",
  "snapchat",
  "discord",
  "patreon",
  "soundcloud",
  "applemusic",
  "vimeo",
  "behance",
  "dribbble",
  "substack",
  "medium",
  "etsy",
  "shopify",
  "calendly",
  "googlemaps",
] as const;

export const socialNetworkSchema = z.enum(SOCIAL_NETWORKS);
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** Nombre visible de cada plataforma (panel y lector de pantalla). */
export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  whatsapp: "WhatsApp",
  threads: "Threads",
  pinterest: "Pinterest",
  spotify: "Spotify",
  github: "GitHub",
  website: "Sitio web",
  onlyfans: "OnlyFans",
  twitch: "Twitch",
  kick: "Kick",
  telegram: "Telegram",
  snapchat: "Snapchat",
  discord: "Discord",
  patreon: "Patreon",
  soundcloud: "SoundCloud",
  applemusic: "Apple Music",
  vimeo: "Vimeo",
  behance: "Behance",
  dribbble: "Dribbble",
  substack: "Substack",
  medium: "Medium",
  etsy: "Etsy",
  shopify: "Shopify",
  calendly: "Calendly",
  googlemaps: "Google Maps",
};

/** Dominio → plataforma, para reconocerla sola a partir del enlace (PP8). */
const NETWORK_HOSTS: ReadonlyArray<[SocialNetwork, readonly string[]]> = [
  ["instagram", ["instagram.com", "instagr.am"]],
  ["facebook", ["facebook.com", "fb.com", "fb.me", "m.me"]],
  ["tiktok", ["tiktok.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["linkedin", ["linkedin.com", "lnkd.in"]],
  ["x", ["x.com", "twitter.com"]],
  ["whatsapp", ["wa.me", "whatsapp.com"]],
  ["threads", ["threads.net", "threads.com"]],
  ["pinterest", ["pinterest.com", "pin.it"]],
  ["spotify", ["spotify.com", "spotify.link"]],
  ["github", ["github.com"]],
  ["onlyfans", ["onlyfans.com"]],
  ["twitch", ["twitch.tv"]],
  ["kick", ["kick.com"]],
  ["telegram", ["t.me", "telegram.me", "telegram.org"]],
  ["snapchat", ["snapchat.com"]],
  ["discord", ["discord.gg", "discord.com"]],
  ["patreon", ["patreon.com"]],
  ["soundcloud", ["soundcloud.com"]],
  ["applemusic", ["music.apple.com"]],
  ["vimeo", ["vimeo.com"]],
  ["behance", ["behance.net"]],
  ["dribbble", ["dribbble.com"]],
  ["substack", ["substack.com"]],
  ["medium", ["medium.com"]],
  ["etsy", ["etsy.com"]],
  ["shopify", ["myshopify.com"]],
  ["calendly", ["calendly.com"]],
  ["googlemaps", ["maps.google.com", "maps.app.goo.gl", "goo.gl/maps"]],
];

/**
 * Plataforma de un enlace por su dominio (o un subdominio: `ana.substack.com`), o `null` si no es
 * de una conocida. Así, quien pega `instagram.com/ana` ve el logo de Instagram sin elegir nada.
 */
export function detectSocialNetwork(url: string): SocialNetwork | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const hostAndPath = `${host}${parsed.pathname.toLowerCase()}`;
  for (const [network, hosts] of NETWORK_HOSTS) {
    if (hosts.some((candidate) => (candidate.includes("/") ? hostAndPath.startsWith(candidate) : host === candidate || host.endsWith(`.${candidate}`)))) {
      return network;
    }
  }
  return null;
}
