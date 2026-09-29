// Esquemas Zod compartidos entre apps y API. Cada módulo de dominio agrega los suyos acá cuando
// el mismo contrato lo necesitan cliente y servidor (el servidor siempre revalida, ST §15).
import { z } from "zod";
import { es } from "zod/locales";

// Mensajes de validación en español en todo el sistema: sin esto, cualquier error que no tenga un
// mensaje propio escrito a mano (`.superRefine`, como `safeUrlSchema`) sale con el texto en inglés
// de Zod por defecto ("Too small: expected string to have >=1 characters") — inconsistente con una
// interfaz que es español de punta a punta, tanto en el servidor (mensajes de la API) como en el
// cliente (el motor de campos del constructor, `apps/dashboard/lib/block-fields`). Efecto de
// módulo, una sola vez por proceso: cualquier consumidor de `@impulza/validation` (API, dashboard,
// web) queda cubierto con solo importar este paquete, sin repetir la configuración en cada app.
z.config(es());

export {
  slugSchema,
  publicSlugSchema,
  pageSlugSchema,
  HOME_PAGE_SLUG,
  isReservedSlug,
  RESERVED_SLUGS,
} from "./slug.js";
export {
  contrastRatio,
  relativeLuminance,
  meetsAaNormalText,
  meetsAaUiComponent,
  HEX_COLOR_PATTERN,
  AA_NORMAL_TEXT,
  AA_LARGE_TEXT,
  AA_UI_COMPONENT,
} from "./contrast.js";
export * from "./blocks/index.js";
export * from "./themes/index.js";
export * from "./seo/index.js";
export * from "./forms/index.js";
export * from "./contacts/index.js";
export * from "./qr/index.js";
export * from "./short-links/index.js";
export * from "./plans/index.js";
export * from "./media/index.js";
export * from "./backgrounds/index.js";
export * from "./templates/index.js";
export { TEMPLATE_CATALOG } from "./templates/catalog.js";
export * from "./domains/index.js";
export * from "./bookings/index.js";
export * from "./catalog/index.js";
export * from "./campaigns/index.js";
export * from "./health/index.js";
export * from "./ai/index.js";
export * from "./ab/index.js";
