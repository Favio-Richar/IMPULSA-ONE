import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

export const siteStatus = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);

export const siteResponse = z.object({
  id: uuid,
  organizationId: uuid,
  name: z.string(),
  /** Identidad pública del sitio (`slug.dominio`). Único en toda la plataforma. */
  slug: z.string(),
  status: siteStatus,
  /** `null` = el sitio usa el tema por defecto del catálogo (ver `GET /sites/:siteId/theme`). */
  themeId: uuid.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const pageVisibility = z.enum(["PUBLIC", "HIDDEN"]);
export const pageStatus = z.enum(["DRAFT", "PUBLISHED"]);

export const pageResponse = z.object({
  id: uuid,
  siteId: uuid,
  slug: z.string(),
  /** Orden dentro del sitio, siempre 0..n-1 sin huecos. */
  position: z.number().int(),
  visibility: pageVisibility,
  status: pageStatus,
  /** La página de inicio: no se elimina ni cambia de slug, y se sirve en la raíz del sitio. */
  isHome: z.boolean(),
  /** Lo que el usuario escribió, todo opcional — forma exacta en `@impulza/validation`
   *  (`seoMetaSchema`, F2.8), mismo criterio que `BlockResponse.config`. El render público no lee
   *  esto directamente: consume `publicSeoResponse` de `public.ts`, ya con los valores por defecto
   *  resueltos cuando el usuario no puso nada. */
  seoMeta: z.unknown().nullable(),
  /** Borrado lógico: con valor, la página está en la papelera pero conserva su historial. */
  deletedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

/**
 * Bloque con la configuración de su versión vigente.
 *
 * `config` es `unknown` a propósito y no una unión de los 15 tipos: su forma depende de `type` y
 * el catálogo que la define vive en `@impulza/validation`. Describirla acá obligaría a mantener
 * dos copias del catálogo, que es justo lo que este contrato quiere evitar. El cliente estrecha
 * el tipo con el esquema del catálogo, que es la única fuente de verdad.
 */
export const blockResponse = z.object({
  id: uuid,
  pageId: uuid,
  type: z.string(),
  position: z.number().int(),
  configSchemaVersion: z.number().int(),
  visible: z.boolean(),
  scheduledStart: isoDateTime.nullable(),
  scheduledEnd: isoDateTime.nullable(),
  /** Acción principal de la página (PP5): a lo sumo un bloque por página. Se publica con la página. */
  isPrimary: z.boolean(),
  config: z.unknown(),
  /**
   * Motivo por el que el bloque no se puede renderizar, o `null` si está sano. Un bloque degradado
   * se omite al renderizar en vez de romper la página entera.
   */
  degraded: z.enum(["unknown_type", "future_version", "invalid_config"]).nullable(),
});

/** Autor de una versión de página — `null` si la cuenta que la publicó ya no existe (F2.6). */
const pageVersionAuthor = z.object({ id: uuid, email: z.email() }).nullable();

/**
 * Entrada del historial de una página, sin el snapshot completo (F2.6). Deliberadamente ligero:
 * un historial puede tener decenas de entradas y el snapshot de cada una incluye la configuración
 * de todos los bloques — cargarlo entero en la lista haría pesado justo el endpoint que un panel
 * de historial pide primero. El detalle completo está en `GET .../versions/:versionId`.
 */
export const pageVersionSummaryResponse = z.object({
  id: uuid,
  pageId: uuid,
  versionNumber: z.number().int(),
  publishedAt: isoDateTime,
  createdAt: isoDateTime,
  createdBy: pageVersionAuthor,
});

/**
 * Versión completa, con el snapshot inmutable del contenido en el momento de publicar o
 * restaurar. `contentSnapshot` es `unknown` por la misma razón que `BlockResponse.config`: su
 * forma exacta (campos de la página + lista de bloques) es un detalle interno de almacenamiento
 * del servidor, no un contrato que el cliente construya — solo lo lee para mostrar una vista
 * previa antes de restaurar.
 */
export const pageVersionResponse = pageVersionSummaryResponse.extend({
  contentSnapshot: z.unknown(),
});

/**
 * Salud de página (F6.1): puntaje 0–100 y hallazgos, calculados en el servidor con
 * `evaluatePageHealth` de `@impulza/validation`. `code` y `category` son códigos estables de ese
 * catálogo (`HEALTH_FINDING_CODES`, `HEALTH_CATEGORIES`); se tipan como texto acá para que un código
 * nuevo del servidor no rompa a un cliente anterior — el panel muestra uno genérico si no lo conoce.
 */
export const pageHealthFindingResponse = z.object({
  code: z.string(),
  severity: z.enum(["critical", "warning", "info"]),
  category: z.string(),
  blockId: uuid.optional(),
  blockType: z.string().optional(),
  count: z.number().int().optional(),
});

export const pageHealthResponse = z.object({
  score: z.number().int().min(0).max(100),
  findings: z.array(pageHealthFindingResponse),
  checkedAt: isoDateTime,
});

export type PageHealthResponse = z.infer<typeof pageHealthResponse>;
export type PageHealthFindingResponse = z.infer<typeof pageHealthFindingResponse>;

export type SiteResponse = z.infer<typeof siteResponse>;
export type PageResponse = z.infer<typeof pageResponse>;
export type BlockResponse = z.infer<typeof blockResponse>;
export type PageVersionSummaryResponse = z.infer<typeof pageVersionSummaryResponse>;
export type PageVersionResponse = z.infer<typeof pageVersionResponse>;

/** Medición de terceros de un sitio (F7.1, ADR-016): solo identificadores; `null` = apagado. */
export const siteMeasurementResponse = z.object({
  ga4MeasurementId: z.string().nullable(),
  metaPixelId: z.string().nullable(),
});
export type SiteMeasurementResponse = z.infer<typeof siteMeasurementResponse>;
