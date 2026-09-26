import type { DeviceType } from "./taxonomy.js";

// Exclusión de bots (ADR-004 punto 2, ST §10): se descarta antes de persistir. Lista deliberadamente
// amplia por token y no por nombre exacto — un crawler nuevo casi siempre se identifica con
// "bot"/"crawler"/"spider" en el user-agent. Incluye los que generan vistas previas de enlaces
// (WhatsApp, Facebook, Slack, Telegram...): pegar un enlace corto en un chat dispara esa visita
// automáticamente y, sin excluirla, cada enlace compartido contaría un clic que nadie hizo.
const BOT_PATTERN = new RegExp(
  [
    // Doble barra porque esto es un string: con una sola, "\b" era un carácter de retroceso y el
    // patrón nunca coincidía (un "AhrefsBot;" o "SemrushBot;" contaba como visita real).
    // `(?<!cu)`: la marca de teléfonos Cubot ("CUBOT X30") no es un bot.
    "(?<!cu)bot\\b",
    "bot/",
    "crawl",
    "spider",
    "slurp",
    "scrapy",
    "facebookexternalhit",
    "facebookcatalog",
    "whatsapp/",
    "telegrambot",
    "slack-imgproxy",
    "slackbot",
    "discordbot",
    "linkedinbot",
    "embedly",
    "quora link preview",
    "skypeuripreview",
    "vkshare",
    // Solo el agente de vista previa de Pinterest: "[Pinterest/Android]" es la app, o sea una persona
    // que tocó el enlace (su crawler "Pinterestbot" ya cae por "bot").
    "pinterest/0\\.",
    "bingpreview",
    "google-inspectiontool",
    "googleother",
    "lighthouse",
    "pagespeed",
    "gtmetrix",
    "headlesschrome",
    "phantomjs",
    "puppeteer",
    "pingdom",
    "uptimerobot",
    "statuscake",
    "monitor",
    "curl/",
    "wget/",
    "python-requests",
    "python-urllib",
    "aiohttp",
    "httpx",
    "go-http-client",
    "java/",
    "okhttp",
    "apache-httpclient",
    "libwww-perl",
    "node-fetch",
    "undici",
    "axios/",
    "postmanruntime",
    "insomnia",
  ].join("|"),
  "i",
);

/** Un user-agent vacío también es bot: todo navegador real manda uno. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length === 0) {
    return true;
  }
  return BOT_PATTERN.test(userAgent);
}

/** Clasificación gruesa y a propósito: solo la categoría que pide el dashboard (PM §9.12), nunca
 *  modelo, versión ni nada que sirva para distinguir a un visitante de otro (ADR-004, sin
 *  fingerprinting). */
export function detectDeviceType(userAgent: string | null | undefined): DeviceType {
  const ua = userAgent ?? "";
  // Android sin "mobile" **en ninguna parte** es una tablet. Mirar solo lo que sigue a "android" no
  // alcanza: el navegador interno de Instagram repite "Android (35/15; ...)" al final, sin "mobile"
  // detrás, y las visitas desde el teléfono se contaban como de tablet.
  if (/ipad|tablet|kindle|silk|playbook/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
    return "tablet";
  }
  if (/mobi|iphone|ipod|android|windows phone|blackberry|opera mini/i.test(ua)) {
    return "mobile";
  }
  return "desktop";
}
