// Esquemas Zod compartidos entre apps y API. Cada módulo de dominio agrega los suyos acá cuando
// el mismo contrato lo necesitan cliente y servidor (el servidor siempre revalida, ST §15).
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
