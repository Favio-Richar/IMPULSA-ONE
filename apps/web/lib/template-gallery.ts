import type { TemplateResponse } from "@impulza/contracts";
import { TEMPLATE_INDUSTRIES, TEMPLATE_INDUSTRY_LABELS, type TemplateIndustry } from "@impulza/validation";

// Galería pública de plantillas (`/plantillas`): filtros, paginación y resúmenes, como funciones puras. Los filtros viven en la
// dirección (`?rubro=salud&suscripcion=con&q=dental&pagina=2`): la galería funciona sin JavaScript, se puede compartir y el
// servidor la pinta completa (SEO).

/** Plantillas por página: tres filas de tres en escritorio, sin una página interminable. */
export const TEMPLATES_PER_PAGE = 9;

export const SUBSCRIPTION_FILTERS = ["todas", "con", "sin"] as const;
export type SubscriptionFilter = (typeof SUBSCRIPTION_FILTERS)[number];

export interface GalleryQuery {
  rubro: TemplateIndustry | null;
  suscripcion: SubscriptionFilter;
  q: string;
  pagina: number;
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/** Lee los filtros de la dirección. Todo valor desconocido se ignora (nunca rompe la página ni llega a otro lado). */
export function parseGalleryQuery(params: RawParams): GalleryQuery {
  const rubro = first(params.rubro);
  const suscripcion = first(params.suscripcion);
  const pagina = Number.parseInt(first(params.pagina), 10);
  return {
    rubro: (TEMPLATE_INDUSTRIES as readonly string[]).includes(rubro) ? (rubro as TemplateIndustry) : null,
    suscripcion: (SUBSCRIPTION_FILTERS as readonly string[]).includes(suscripcion) ? (suscripcion as SubscriptionFilter) : "todas",
    q: first(params.q).trim().slice(0, 60),
    pagina: Number.isInteger(pagina) && pagina > 0 ? pagina : 1,
  };
}

/** ¿Algún filtro activo? (la paginación sola no cuenta). */
export function hasActiveFilters(query: GalleryQuery): boolean {
  return query.rubro !== null || query.suscripcion !== "todas" || query.q !== "";
}

/** La plantilla trae el botón «Suscribirme» en alguna de sus páginas. */
export function templateHasSubscription(template: Pick<TemplateResponse, "blocks" | "companionPages">): boolean {
  return [template.blocks, ...(template.companionPages ?? []).map((page) => page.blocks)].some((blocks) => blocks.some((block) => block.type === "subscribe"));
}

/** Páginas que crea la plantilla (inicio + compañeras). */
export function templatePageCount(template: Pick<TemplateResponse, "companionPages">): number {
  return 1 + (template.companionPages?.length ?? 0);
}

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filterTemplates<T extends Pick<TemplateResponse, "name" | "description" | "code" | "industryTags" | "blocks" | "companionPages">>(templates: readonly T[], query: GalleryQuery): T[] {
  const needle = normalize(query.q);
  return templates.filter((template) => {
    if (query.rubro && !template.industryTags.includes(query.rubro)) return false;
    if (query.suscripcion !== "todas" && templateHasSubscription(template) !== (query.suscripcion === "con")) return false;
    if (needle) {
      const haystack = normalize([template.name, template.description, template.code, ...template.industryTags.map((tag) => TEMPLATE_INDUSTRY_LABELS[tag])].join(" "));
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

export interface Paginated<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

/** Una página de resultados. Una página fuera de rango cae en la última (nunca una página vacía con resultados de sobra). */
export function paginate<T>(items: readonly T[], page: number, perPage = TEMPLATES_PER_PAGE): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, page), totalPages);
  return { items: items.slice((current - 1) * perPage, current * perPage), page: current, totalPages, total: items.length };
}

/** Dirección de la galería con los filtros dados (sin los valores por defecto: URLs cortas y canónicas). */
export function galleryHref(query: GalleryQuery, overrides: Partial<GalleryQuery> = {}): string {
  const next = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (next.rubro) params.set("rubro", next.rubro);
  if (next.suscripcion !== "todas") params.set("suscripcion", next.suscripcion);
  if (next.q) params.set("q", next.q);
  if (next.pagina > 1) params.set("pagina", String(next.pagina));
  const search = params.toString();
  return search ? `/plantillas?${search}` : "/plantillas";
}

/**
 * Números de página a mostrar: siempre la primera y la última, la actual y sus vecinas; `null` marca un salto («…»).
 * Con pocas páginas, todas.
 */
export function pageWindow(page: number, totalPages: number): Array<number | null> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  sorted.forEach((n, index) => {
    if (index > 0 && n - sorted[index - 1]! > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/** Rubros que tienen al menos una plantilla, en el orden del catálogo (el filtro no ofrece opciones vacías). */
export function industriesInCatalog(templates: ReadonlyArray<Pick<TemplateResponse, "industryTags">>): TemplateIndustry[] {
  const present = new Set(templates.flatMap((template) => template.industryTags));
  return TEMPLATE_INDUSTRIES.filter((industry) => present.has(industry));
}

/** Nombre corto de cada tipo de bloque, para el resumen «qué incluye» de cada página. */
const BLOCK_SUMMARY: Record<string, string> = {
  profile: "perfil",
  engagement: "vistas y «me gusta»",
  whatsapp: "botón de WhatsApp",
  link: "botones",
  showcase: "colecciones",
  stats: "cifras",
  testimonials: "reseñas",
  social: "redes",
  subscribe: "suscripción",
  page_header: "encabezado",
  service: "servicios con precio",
  pricing: "planes y precios",
  booking: "reservas en línea",
  catalog: "tienda",
  map: "mapa",
  faq: "preguntas frecuentes",
  steps: "pasos",
  feature: "presentación",
  album: "álbum con filtros",
  gallery: "galería",
  events: "agenda",
  music: "música",
  video: "video",
  newsletter: "aviso por correo",
  countdown: "cuenta regresiva",
  contact_actions: "correo y teléfono",
  works_wheel: "rueda de trabajos",
  marquee: "cinta de texto",
  text: "texto",
};

/** Resumen legible de los bloques de una página, sin repetir y sin los que no se ven como contenido propio. */
export function blocksSummary(blocks: ReadonlyArray<{ type: string; config?: unknown }>): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    let label = BLOCK_SUMMARY[block.type];
    if (block.type === "gallery" && (block.config as { layout?: string } | undefined)?.layout === "sphere") label = "galería en esfera 3D";
    if (block.type === "showcase" && (block.config as { layout?: string } | undefined)?.layout === "index") label = "índice con portada";
    if (label && !out.includes(label) && block.type !== "page_header" && block.type !== "text") out.push(label);
  }
  return out;
}

/** Nombre visible de una página compañera a partir de su dirección (`reservas` → «Reservas»). */
export function pageTitle(slug: string): string {
  const words: Record<string, string> = { areas: "Áreas", asesoria: "Asesoría", menus: "Menús", sesion: "Sesión", album: "Álbum" };
  return words[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");
}
