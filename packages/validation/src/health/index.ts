import { findImagesWithoutAlt } from "../blocks/primitives.js";
import { parseStoredBlock } from "../blocks/stored-block.js";
import { localDateTimeToInstant } from "../blocks/time.js";
import { seoMetaSchema } from "../seo/index.js";
import { themeTokensSchema } from "../themes/tokens.js";

// Salud de página (F6.1, PM §14.7): un puntaje 0–100 y una lista de hallazgos sobre el estado real
// de una página. Función pura e isomorfa: el servidor la calcula (`GET .../pages/:id/health`) y el
// panel solo la pinta. Nada acá hace peticiones de red — la comprobación de enlaces es estática, a
// propósito: pedir las URLs del usuario desde el servidor sería una vía de SSRF (ST §15).
//
// Cada hallazgo lleva un **código estable** y datos estructurados, nunca texto del usuario: el panel
// arma el mensaje en español a partir del código, y un cambio de redacción no rompe ningún cliente.

export const HEALTH_SEVERITIES = ["critical", "warning", "info"] as const;
export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number];

export const HEALTH_CATEGORIES = ["publication", "content", "action", "seo", "accessibility", "links", "performance"] as const;
export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];

export const HEALTH_FINDING_CODES = [
  "page_not_published",
  "unpublished_changes",
  "page_empty",
  "no_heading",
  "no_action",
  "no_primary_action",
  "block_unrenderable",
  "block_schedule_ended",
  "form_not_configured",
  "booking_without_services",
  "catalog_without_products",
  "countdown_ended",
  "events_all_past",
  "seo_title_generic",
  "seo_description_missing",
  "seo_home_noindex",
  "seo_canonical_missing",
  "image_alt_missing",
  "theme_contrast",
  "insecure_link",
  "duplicate_link",
  "heavy_media",
  "too_many_blocks",
] as const;
export type HealthFindingCode = (typeof HEALTH_FINDING_CODES)[number];

export interface HealthFinding {
  code: HealthFindingCode;
  severity: HealthSeverity;
  category: HealthCategory;
  /** Bloque afectado, si el hallazgo es de un bloque concreto. */
  blockId?: string;
  /** Tipo del bloque afectado, para que el panel diga "el botón de WhatsApp" sin otra consulta. */
  blockType?: string;
  /** Cantidad relevante (imágenes sin descripción, bloques pesados…). */
  count?: number;
}

export interface PageHealthBlock {
  id: string;
  type: string;
  configSchemaVersion: number;
  visible: boolean;
  isPrimary: boolean;
  scheduledEnd: Date | null;
  config: unknown;
}

export interface PageHealthInput {
  page: {
    isHome: boolean;
    status: "DRAFT" | "PUBLISHED";
    visibility: "PUBLIC" | "HIDDEN";
    seoMeta: unknown;
    /** Hay contenido vivo que ninguna versión publicada guarda. */
    hasUnpublishedChanges: boolean;
  };
  blocks: readonly PageHealthBlock[];
  /** Tokens del tema efectivo del sitio (propio o el de defecto). */
  themeTokens: unknown;
  /** Lo que la página referencia fuera de sí misma, resuelto por el servidor. */
  resources: {
    existingFormIds: ReadonlySet<string>;
    activeServiceIds: ReadonlySet<string>;
    activeProducts: ReadonlyArray<{ id: string; categoryId: string | null }>;
    /** Slugs de las páginas vivas publicadas del sitio (para validar el canonical). */
    publishedPageSlugs: ReadonlySet<string>;
  };
  now: Date;
}

export interface PageHealthReport {
  score: number;
  findings: HealthFinding[];
}

// Peso de cada severidad en el puntaje. Un hallazgo crítico (la página no sirve a su objetivo:
// no está publicada, no tiene acción, un formulario roto) pesa lo mismo que tres advertencias.
export const HEALTH_PENALTY: Record<HealthSeverity, number> = { critical: 24, warning: 8, info: 2 };

/** Bloques cuya razón de ser es que el visitante actúe (contactar, comprar, reservar, ir a un enlace). */
const ACTION_BLOCK_TYPES = new Set(["link", "whatsapp", "contact_actions", "contact_form", "booking", "catalog", "newsletter"]);

/** Más de estos bloques pesados y la página se vuelve lenta en un teléfono con datos móviles. */
export const HEAVY_MEDIA_LIMITS = { videos: 3, images: 30 } as const;
export const MAX_RECOMMENDED_BLOCKS = 25;

const SEVERITY_ORDER: Record<HealthSeverity, number> = { critical: 0, warning: 1, info: 2 };

function readString(config: unknown, key: string): string | undefined {
  if (!config || typeof config !== "object") {
    return undefined;
  }
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Toda URL de primer nivel o anidada que el visitante puede abrir, sin las de imágenes. */
function collectLinkUrls(type: string, config: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim() !== "") {
      urls.push(value.trim());
    }
  };
  switch (type) {
    case "link":
      push(config.url);
      break;
    case "image":
      push(config.link);
      break;
    case "hero":
    case "service":
      push((config.cta as Record<string, unknown> | undefined)?.url);
      break;
    case "social":
      for (const link of (config.links as Array<Record<string, unknown>> | undefined) ?? []) {
        push(link.url);
      }
      break;
    case "profile":
      for (const link of (config.socials as Array<Record<string, unknown>> | undefined) ?? []) {
        push(link.url);
      }
      break;
    case "testimonials":
      push(config.reviewsUrl);
      break;
    case "countdown":
      push((config.cta as Record<string, unknown> | undefined)?.url);
      break;
    case "pricing":
      for (const plan of (config.plans as Array<Record<string, unknown>> | undefined) ?? []) {
        push((plan.cta as Record<string, unknown> | undefined)?.url);
      }
      break;
    case "events":
      for (const item of (config.items as Array<Record<string, unknown>> | undefined) ?? []) {
        push(item.ticketUrl);
      }
      break;
    default:
      break;
  }
  return urls;
}

function countImages(type: string, config: Record<string, unknown>): number {
  if (type === "gallery") {
    return Array.isArray(config.images) ? config.images.length : 0;
  }
  return ["image", "background", "avatar", "cover"].filter((key) => readString(config[key], "url") !== undefined).length;
}

/** Normaliza una URL para detectar duplicados: sin barra final, host en minúsculas. */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  } catch {
    return url;
  }
}

export function evaluatePageHealth(input: PageHealthInput): PageHealthReport {
  const findings: HealthFinding[] = [];
  const add = (finding: HealthFinding) => findings.push(finding);
  const { page, resources, now } = input;

  // --- Publicación ------------------------------------------------------------------------------
  if (page.status !== "PUBLISHED") {
    add({ code: "page_not_published", severity: "critical", category: "publication" });
  } else if (page.hasUnpublishedChanges) {
    add({ code: "unpublished_changes", severity: "info", category: "publication" });
  }

  // Lo que el visitante ve de verdad: bloques visibles cuya programación no terminó.
  const shown = input.blocks.filter((block) => block.visible && !(block.scheduledEnd && block.scheduledEnd <= now));
  for (const block of input.blocks) {
    if (block.visible && block.scheduledEnd && block.scheduledEnd <= now) {
      add({ code: "block_schedule_ended", severity: "info", category: "content", blockId: block.id, blockType: block.type });
    }
  }

  if (shown.length === 0) {
    add({ code: "page_empty", severity: "critical", category: "content" });
  }

  // --- Bloque por bloque -------------------------------------------------------------------------
  const renderable: Array<{ block: PageHealthBlock; config: Record<string, unknown> }> = [];
  for (const block of shown) {
    const parsed = parseStoredBlock(block.type, block.configSchemaVersion, block.config);
    if (!parsed.renderable) {
      add({ code: "block_unrenderable", severity: "critical", category: "content", blockId: block.id, blockType: block.type });
      continue;
    }
    renderable.push({ block, config: parsed.config as Record<string, unknown> });
  }

  let videos = 0;
  let images = 0;
  const seenUrls = new Map<string, string>();

  for (const { block, config } of renderable) {
    const ref = { blockId: block.id, blockType: block.type };

    if (block.type === "contact_form") {
      const formId = typeof config.formId === "string" ? config.formId : null;
      if (!formId || !resources.existingFormIds.has(formId)) {
        add({ code: "form_not_configured", severity: "critical", category: "action", ...ref });
      }
    }

    if (block.type === "booking") {
      const ids = Array.isArray(config.serviceIds) ? (config.serviceIds as string[]) : null;
      const available = ids ? ids.filter((id) => resources.activeServiceIds.has(id)).length : resources.activeServiceIds.size;
      if (available === 0) {
        add({ code: "booking_without_services", severity: "critical", category: "action", ...ref });
      }
    }

    if (block.type === "catalog") {
      const ids = Array.isArray(config.productIds) ? new Set(config.productIds as string[]) : null;
      const categoryId = typeof config.categoryId === "string" ? config.categoryId : null;
      const available = resources.activeProducts.filter(
        (product) => (!ids || ids.has(product.id)) && (!categoryId || product.categoryId === categoryId),
      ).length;
      if (available === 0) {
        add({ code: "catalog_without_products", severity: "critical", category: "action", ...ref });
      }
    }

    // F7.3: un bloque con fecha que ya pasó sigue en la página. La cuenta regresiva que se oculta al
    // terminar ya no se ve, pero igual conviene quitarla o poner la fecha siguiente.
    if (block.type === "countdown") {
      const target = localDateTimeToInstant(String(config.target), String(config.timeZone));
      if (target && target <= now) {
        add({ code: "countdown_ended", severity: "warning", category: "content", ...ref });
      }
    }
    if (block.type === "events") {
      const timeZone = String(config.timeZone);
      const items = (config.items as Array<Record<string, unknown>> | undefined) ?? [];
      const upcoming = items.filter((item) => {
        const until = localDateTimeToInstant(String(item.end ?? item.start), timeZone);
        return until !== null && until > now;
      });
      if (upcoming.length === 0) {
        add({ code: "events_all_past", severity: "warning", category: "content", ...ref });
      }
    }

    const missingAlt = findImagesWithoutAlt(config).length;
    if (missingAlt > 0) {
      add({ code: "image_alt_missing", severity: "warning", category: "accessibility", ...ref, count: missingAlt });
    }

    let insecure = 0;
    for (const url of collectLinkUrls(block.type, config)) {
      if (url.toLowerCase().startsWith("http://")) {
        insecure += 1;
      }
      if (block.type === "link") {
        const key = normalizeUrl(url);
        if (seenUrls.has(key)) {
          add({ code: "duplicate_link", severity: "info", category: "links", ...ref });
        } else {
          seenUrls.set(key, block.id);
        }
      }
    }
    if (insecure > 0) {
      add({ code: "insecure_link", severity: "warning", category: "links", ...ref, count: insecure });
    }

    // Un reproductor de música pesa como un video (iframe de terceros); el mapa no, porque se carga
    // solo si el visitante lo pide (ADR-018).
    if (block.type === "video" || block.type === "music") {
      videos += 1;
    }
    images += countImages(block.type, config);
  }

  // --- Estructura y acción -------------------------------------------------------------------------
  const types = new Set(renderable.map(({ block }) => block.type));
  if (renderable.length > 0 && !types.has("profile") && !types.has("hero")) {
    add({ code: "no_heading", severity: "warning", category: "content" });
  }

  const actions = renderable.filter(({ block }) => ACTION_BLOCK_TYPES.has(block.type));
  if (renderable.length > 0 && actions.length === 0) {
    add({ code: "no_action", severity: "critical", category: "action" });
  } else if (actions.length > 0 && !renderable.some(({ block }) => block.isPrimary)) {
    add({ code: "no_primary_action", severity: "info", category: "action" });
  }

  // --- SEO -----------------------------------------------------------------------------------------
  const seo = seoMetaSchema.safeParse(page.seoMeta ?? {});
  const seoMeta = seo.success ? seo.data : {};
  const derivedTitle = renderable.some(
    ({ block, config }) => (block.type === "profile" && readString(config, "name")) || (block.type === "hero" && readString(config, "title")),
  );
  if (!seoMeta.title && !derivedTitle) {
    add({ code: "seo_title_generic", severity: "warning", category: "seo" });
  }
  const derivedDescription = renderable.some(({ block, config }) =>
    (block.type === "hero" && readString(config, "subtitle")) ||
    (block.type === "profile" && (readString(config, "headline") ?? readString(config, "bio"))) ||
    (block.type === "service" && readString(config, "description")) ||
    (block.type === "text" && readString(config, "html")),
  );
  if (!seoMeta.description && !derivedDescription) {
    add({ code: "seo_description_missing", severity: "warning", category: "seo" });
  }
  if (page.isHome && page.visibility === "PUBLIC" && seoMeta.robots?.startsWith("noindex")) {
    add({ code: "seo_home_noindex", severity: "warning", category: "seo" });
  }
  if (seoMeta.canonicalPageSlug && !resources.publishedPageSlugs.has(seoMeta.canonicalPageSlug)) {
    add({ code: "seo_canonical_missing", severity: "warning", category: "seo" });
  }

  // --- Accesibilidad del tema ------------------------------------------------------------------------
  // Un tema se valida contra AA al guardarlo; esto atrapa temas guardados antes de una regla nueva.
  if (input.themeTokens !== null && !themeTokensSchema.safeParse(input.themeTokens).success) {
    add({ code: "theme_contrast", severity: "critical", category: "accessibility" });
  }

  // --- Rendimiento -----------------------------------------------------------------------------------
  if (videos > HEAVY_MEDIA_LIMITS.videos || images > HEAVY_MEDIA_LIMITS.images) {
    add({ code: "heavy_media", severity: "warning", category: "performance", count: videos + images });
  }
  if (shown.length > MAX_RECOMMENDED_BLOCKS) {
    add({ code: "too_many_blocks", severity: "info", category: "performance", count: shown.length });
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const penalty = findings.reduce((sum, finding) => sum + HEALTH_PENALTY[finding.severity], 0);
  return { score: Math.max(0, 100 - penalty), findings };
}
