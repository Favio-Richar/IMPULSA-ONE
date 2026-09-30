import { GA4_MEASUREMENT_ID, META_PIXEL_ID, type ProviderCall } from "@impulza/validation";

// Carga de los proveedores de medición en el navegador (F7.1, ADR-016). Solo se llama con el
// consentimiento del visitante. Los scripts son siempre los oficiales, armados con un identificador
// que ya pasó la validación del servidor (y se vuelve a comprobar acá): nunca código del negocio.

type Gtag = (...args: unknown[]) => void;
type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[][]; callMethod?: (...args: unknown[]) => void; loaded?: boolean; version?: string; push?: unknown };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    fbq?: Fbq;
    _fbq?: Fbq;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

function appendScript(src: string, id: string): void {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

/**
 * GA4 con `gtag.js`: vista de página automática; señales de Google y personalización de anuncios
 * desactivadas (minimización, ADR-016 §3). Volver a llamarla tras retirar el consentimiento lo
 * reactiva.
 */
export function loadGa4(measurementId: string): boolean {
  if (!GA4_MEASUREMENT_ID.test(measurementId)) return false;
  window[`ga-disable-${measurementId}`] = false;
  if (!window.gtag) {
    window.dataLayer = window.dataLayer ?? [];
    // `gtag` tiene que empujar el objeto `arguments` tal cual: así lo espera gtag.js.
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", measurementId, { allow_google_signals: false, allow_ad_personalization_signals: false });
    appendScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`, "impulza-ga4");
  }
  return true;
}

/** Retirar el consentimiento de analítica: GA4 deja de enviar y se borran sus cookies propias. */
export function disableGa4(measurementId: string): void {
  if (!GA4_MEASUREMENT_ID.test(measurementId)) return;
  window[`ga-disable-${measurementId}`] = true;
  deleteCookies((name) => name === "_ga" || name.startsWith("_ga_"));
}

/** Píxel de Meta: la cola estándar de `fbq` más su script oficial, y la vista de página. */
export function loadMetaPixel(pixelId: string): boolean {
  if (!META_PIXEL_ID.test(pixelId)) return false;
  if (!window.fbq) {
    const fbq = ((...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue!.push(args);
    }) as Fbq;
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.push = fbq;
    window.fbq = fbq;
    window._fbq = fbq;
    appendScript("https://connect.facebook.net/en_US/fbevents.js", "impulza-meta-pixel");
    fbq("init", pixelId);
  }
  window.fbq("consent", "grant");
  window.fbq("track", "PageView");
  return true;
}

/** Retirar el consentimiento de publicidad: el píxel deja de enviar y se borra su cookie propia. */
export function disableMetaPixel(): void {
  window.fbq?.("consent", "revoke");
  deleteCookies((name) => name === "_fbp");
}

/** Envía las llamadas ya decididas por `providerCallsFor` (que aplica el consentimiento). */
export function sendProviderCalls(calls: ProviderCall[]): void {
  for (const call of calls) {
    try {
      if (call.provider === "ga4") window.gtag?.("event", call.name, call.params);
      else window.fbq?.("track", call.name, call.params);
    } catch {
      // Un proveedor que falla nunca rompe la página.
    }
  }
}

/** Borra cookies propias del sitio por nombre, en el dominio actual y en el padre (así las fijan). */
function deleteCookies(matches: (name: string) => boolean): void {
  const host = window.location.hostname;
  const parts = host.split(".");
  const domains = ["", host, ...(parts.length > 2 ? [`.${parts.slice(-2).join(".")}`] : []), `.${host}`];
  for (const entry of document.cookie.split(";")) {
    const name = entry.split("=")[0]?.trim();
    if (!name || !matches(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ""}; SameSite=Lax`;
    }
  }
}
