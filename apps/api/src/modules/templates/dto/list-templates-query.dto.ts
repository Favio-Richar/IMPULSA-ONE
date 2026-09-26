import { TEMPLATE_INDUSTRIES, TEMPLATE_OBJECTIVES, THEME_FAMILIES } from "@impulza/validation";
import { z } from "zod";

// Filtros de la galería (PM §7.4: industria, objetivo y estilo). Todos opcionales y combinables;
// un valor fuera del catálogo es un 400, no una lista vacía silenciosa.
export const listTemplatesQuerySchema = z.object({
  industry: z.enum(TEMPLATE_INDUSTRIES).optional(),
  objective: z.enum(TEMPLATE_OBJECTIVES).optional(),
  family: z.enum(THEME_FAMILIES).optional(),
});

export type ListTemplatesQueryDto = z.infer<typeof listTemplatesQuerySchema>;
