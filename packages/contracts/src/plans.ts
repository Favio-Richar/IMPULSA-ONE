import { z } from "zod";
import { uuid } from "./primitives.js";

// Planes y uso (F4.1). Duplica la forma de `planLimitsSchema` de `@impulza/validation` en vez de
// importarla: este paquete no depende de `validation` (mismo criterio que `PUBLIC_SEO_ROBOTS_VALUES`
// en public.ts). Si el catálogo de límites cambia allá, cambia acá también.

const limitValue = z.number().int().nullable();

export const planLimitsResponse = z.object({
  sites: limitValue,
  pagesPerSite: limitValue,
  forms: limitValue,
  contacts: limitValue,
  shortLinks: limitValue,
  qrCodes: limitValue,
  members: limitValue,
  analyticsHistoryDays: limitValue,
  storageMb: limitValue,
});

export const planResponse = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  /** En la unidad mínima de la moneda (CLP: pesos). */
  priceMonthly: z.number().int(),
  priceYearly: z.number().int(),
  currency: z.string(),
  sortOrder: z.number().int(),
  limits: planLimitsResponse,
});

/** Uso actual contra cada límite de nivel organización. */
export const planUsageResponse = z.object({
  sites: z.number().int(),
  forms: z.number().int(),
  contacts: z.number().int(),
  shortLinks: z.number().int(),
  qrCodes: z.number().int(),
  members: z.number().int(),
  /** Almacenamiento de medios usado, en MB redondeados hacia arriba (PP1, ADR-006 §6). */
  storageMb: z.number().int(),
});

export const organizationPlanResponse = z.object({
  plan: planResponse,
  /** De dónde sale el plan efectivo: una suscripción vigente, una asignación manual de
   *  superadministración, o el plan por defecto. */
  source: z.enum(["subscription", "assigned", "default"]),
  usage: planUsageResponse,
});

export type PlanLimitsResponse = z.infer<typeof planLimitsResponse>;
export type PlanResponse = z.infer<typeof planResponse>;
export type PlanUsageResponse = z.infer<typeof planUsageResponse>;
export type OrganizationPlanResponse = z.infer<typeof organizationPlanResponse>;
