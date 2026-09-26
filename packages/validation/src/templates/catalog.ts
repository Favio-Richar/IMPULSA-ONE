import type { TemplateDefinition } from "./index.js";

/**
 * Catálogo de plantillas de la plataforma (PL3). Lo siembra `packages/database/prisma/seed.ts`,
 * que valida cada entrada con `templateSchema` antes de escribirla: una plantilla inválida detiene
 * el seed en vez de llegar a la base.
 *
 * Todo el contenido es **ficticio** (ADR-008, "Restricciones asociadas"): ningún nombre, texto,
 * logo ni imagen de Linktree, Beacons, Stan ni de cuentas reales.
 */
export const TEMPLATE_CATALOG: readonly TemplateDefinition[] = [];
