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
  config: z.unknown(),
  /**
   * Motivo por el que el bloque no se puede renderizar, o `null` si está sano. Un bloque degradado
   * se omite al renderizar en vez de romper la página entera.
   */
  degraded: z.enum(["unknown_type", "future_version", "invalid_config"]).nullable(),
});

export type SiteResponse = z.infer<typeof siteResponse>;
export type PageResponse = z.infer<typeof pageResponse>;
export type BlockResponse = z.infer<typeof blockResponse>;
