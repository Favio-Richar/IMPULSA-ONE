// Esquemas Zod compartidos entre apps y API. Cada módulo de dominio agrega los suyos acá cuando
// el mismo contrato lo necesitan cliente y servidor (el servidor siempre revalida, ST §15).
export { slugSchema, publicSlugSchema, isReservedSlug, RESERVED_SLUGS } from "./slug.js";
