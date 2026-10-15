import type { TemplateBlockSeed, TemplateDefinition } from "./index.js";
import { block, img, type PhotoKey } from "./portal-content.js";

// Piezas propias de las plantillas del editor de portales (rubros nuevos). Mismos criterios que `portal-content.ts`: todo de
// ejemplo, ningún botón a un sitio inexistente (cada destino es una página del portal, `page:<slug>`), una sola acción principal
// por página, y las vistas y «me gusta» (`engagement`) justo debajo del perfil.

type Seed = TemplateBlockSeed;

/** Planes con su botón hacia la página que se indique (el constructor base los manda siempre a `contacto`). */
export const pricingTo = (
  page: string,
  title: string,
  plans: Array<{ name: string; price: number; period: "once" | "month" | "year"; description: string; features: string[]; badge?: string; highlighted?: boolean; cta: string }>,
): Seed =>
  block("pricing", {
    title,
    plans: plans.map((plan) => ({
      name: plan.name,
      priceAmount: plan.price,
      priceCurrency: "CLP",
      period: plan.period,
      description: plan.description,
      features: plan.features,
      ...(plan.badge ? { badge: plan.badge } : {}),
      highlighted: plan.highlighted === true,
      cta: { label: plan.cta, url: `page:${page}` },
    })),
  });

/** Agenda de fechas con el botón de cada fecha hacia la página que se indique. */
export const eventsTo = (page: string, title: string, items: Array<{ name: string; start: string; venue: string; description: string; label: string }>): Seed =>
  block("events", {
    title,
    timeZone: "America/Santiago",
    items: items.map(({ label, ...item }) => ({ ...item, ticketUrl: `page:${page}`, ticketLabel: label, soldOut: false })),
  });

/** Galería en esfera 3D (diseño `sphere`): con pocas fotos se completa sola; sin JavaScript se ve en cuadrícula. */
export const sphere = (photos: Array<[PhotoKey, string]>): Seed => block("gallery", { layout: "sphere", images: photos.map(([key, alt]) => img(key, alt, 600)) });

/** Productos del sitio (los que el negocio cargue en su catálogo). */
export const shop = (label: string): Seed => block("catalog", { label });

/** Cuenta regresiva hasta una fecha local, con botón hacia una página del portal. */
export const countdown = (title: string, target: string, ctaLabel: string, page: string): Seed =>
  block("countdown", { title, target, timeZone: "America/Santiago", endedBehavior: "message", endedMessage: "¡Ya llegó el gran día! Gracias por acompañarnos.", cta: { label: ctaLabel, url: `page:${page}` } });

/** Enlace del inicio hacia una página interna, como acción principal (o no). */
export const go = (label: string, page: string, description?: string, primary = false): Seed =>
  block("link", { label, url: `page:${page}`, ...(description ? { description } : {}), style: primary ? "primary" : "secondary", shareable: true }, primary);

type Meta = Omit<TemplateDefinition, "blocksSeed" | "companionPages" | "previewImageUrl" | "background"> & {
  background?: TemplateDefinition["background"];
};

/** Una plantilla de portal: inicio + dos páginas (el máximo que admite el plan gratis, `TEMPLATE_MAX_COMPANION_PAGES`). */
export function portalTemplate(meta: Meta, home: Seed[], pages: [{ slug: string; blocks: Seed[] }, { slug: string; blocks: Seed[] }]): TemplateDefinition {
  return {
    ...meta,
    background: meta.background ?? null,
    previewImageUrl: null,
    blocksSeed: home,
    companionPages: pages.map((page) => ({ slug: page.slug, blocksSeed: page.blocks })),
  };
}
