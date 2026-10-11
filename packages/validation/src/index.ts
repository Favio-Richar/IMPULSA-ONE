// Esquemas Zod compartidos entre apps y API. Cada módulo de dominio agrega los suyos acá cuando
// el mismo contrato lo necesitan cliente y servidor (el servidor siempre revalida, ST §15).
// Primero, antes que cualquier esquema: idioma de los mensajes y modo sin `eval` en el navegador.
import "./zod-config.js";

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
export * from "./smart-cta/index.js";
export * from "./automations/index.js";
export * from "./measurement/index.js";
export * from "./webhooks/index.js";
export * from "./newsletter/index.js";
export * from "./sequences/index.js";
export * from "./billing/index.js";
export * from "./funnels/index.js";
export * from "./page-campaigns/index.js";
export * from "./coupons/index.js";
export * from "./admin/index.js";
export * from "./branding/index.js";
export * from "./branding/resolve.js";
export * from "./branding/email.js";
export * from "./agency/index.js";
export * from "./agency/dashboard.js";
export * from "./agency/billing.js";
export * from "./agency/transfer.js";
export * from "./agency/duplicate.js";
export * from "./agency/import-csv.js";
export * from "./team/index.js";
export * from "./team/agency-scope.js";
export * from "./publish/index.js";
export * from "./audit/index.js";
