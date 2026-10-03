import { z } from "zod";
import { AGENCY_CLIENT_STATUSES, type AgencyClientStatusValue } from "./index.js";

// Panel de agencia (F9.4, ADR-028). Reglas puras del consolidado: la API las usa para armar la respuesta y las pruebas
// unitarias las ejercitan sin base de datos. El consolidado solo suma clientes `ACTIVE` (criterio 2): un cliente en pausa,
// archivado o sin aceptar no entra en ningún total.

export const AGENCY_DASHBOARD_DAYS = [7, 30, 90] as const;
export type AgencyDashboardDays = (typeof AGENCY_DASHBOARD_DAYS)[number];
export const DEFAULT_AGENCY_DASHBOARD_DAYS: AgencyDashboardDays = 30;

const daysSchema = z.coerce
  .number()
  .int()
  .refine((value): value is AgencyDashboardDays => (AGENCY_DASHBOARD_DAYS as readonly number[]).includes(value), {
    message: "Elige 7, 30 o 90 días.",
  })
  .default(DEFAULT_AGENCY_DASHBOARD_DAYS);

export const agencyDashboardQuerySchema = z.object({ days: daysSchema });
export type AgencyDashboardQuery = z.infer<typeof agencyDashboardQuerySchema>;

export const AGENCY_OVERVIEW_SORTS = ["name", "status", "createdAt"] as const;
export const AGENCY_OVERVIEW_MAX_PAGE_SIZE = 50;

export const agencyOverviewQuerySchema = z.object({
  days: daysSchema,
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value ? value : undefined)),
  status: z.enum(AGENCY_CLIENT_STATUSES).optional(),
  sort: z.enum(AGENCY_OVERVIEW_SORTS).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(AGENCY_OVERVIEW_MAX_PAGE_SIZE).default(20),
});
export type AgencyOverviewQuery = z.infer<typeof agencyOverviewQuerySchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rango de fechas (UTC, ambos extremos incluidos) que termina hoy y cubre `days` días: el mismo formato `YYYY-MM-DD` de los agregados. */
export function dashboardRange(days: number, now: Date): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00.000Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { from, to };
}

/** Cuántos clientes hay en cada estado (todos los estados aparecen, con 0 si no hay ninguno). */
export function countByStatus(statuses: readonly AgencyClientStatusValue[]): Record<AgencyClientStatusValue, number> {
  const counts = Object.fromEntries(AGENCY_CLIENT_STATUSES.map((status) => [status, 0])) as Record<AgencyClientStatusValue, number>;
  for (const status of statuses) counts[status] += 1;
  return counts;
}

/** Solo un cliente `ACTIVE` suma al consolidado (pausado, archivado, sin aceptar o en traspaso: no). */
export function countsTowardsTotals(status: AgencyClientStatusValue): boolean {
  return status === "ACTIVE";
}

/** Uso del cupo entre 0 y 1 (puede pasar de 1 si el cliente quedó sobre el límite); `null` si no hay límite. */
export function usageRatio(used: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit <= 0) return used > 0 ? Number.POSITIVE_INFINITY : 0;
  return used / limit;
}

export const NEAR_LIMIT_RATIO = 0.8;

export function isNearLimit(used: number, limit: number | null): boolean {
  const ratio = usageRatio(used, limit);
  return ratio !== null && ratio >= NEAR_LIMIT_RATIO;
}

export type AgencyAlertCode = "DOMAIN_FAILED" | "DOMAIN_PENDING" | "NEAR_PLAN_LIMIT" | "SITE_HIDDEN" | "NEVER_PUBLISHED";
export type AgencyAlertSeverity = "critical" | "warning" | "info";
export interface AgencyAlert {
  code: AgencyAlertCode;
  severity: AgencyAlertSeverity;
  message: string;
}

export interface ClientAlertInput {
  domainsFailed: number;
  domainsPending: number;
  /** Nombres legibles de los límites del plan en 80 % o más (p. ej. «sitios»). */
  nearLimits: readonly string[];
  publicHidden: boolean;
  /** `null` = ningún sitio con una página publicada. */
  lastPublishedAt: Date | null;
  siteCount: number;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * Alertas de un cliente, de más a menos graves. No incluye nada de su suscripción ni de sus pagos: la agencia no los ve
 * (límite duro del ADR-028 §2); las alertas de cobro de los clientes que paga la agencia llegan con F9.5.
 */
export function buildClientAlerts(input: ClientAlertInput): AgencyAlert[] {
  const alerts: AgencyAlert[] = [];
  if (input.domainsFailed > 0) {
    alerts.push({
      code: "DOMAIN_FAILED",
      severity: "critical",
      message: `${plural(input.domainsFailed, "dominio falló", "dominios fallaron")} la verificación.`,
    });
  }
  if (input.publicHidden) {
    alerts.push({ code: "SITE_HIDDEN", severity: "warning", message: "El sitio público está oculto por la agencia." });
  }
  if (input.domainsPending > 0) {
    alerts.push({
      code: "DOMAIN_PENDING",
      severity: "warning",
      message: `${plural(input.domainsPending, "dominio sin verificar", "dominios sin verificar")}.`,
    });
  }
  if (input.nearLimits.length > 0) {
    alerts.push({ code: "NEAR_PLAN_LIMIT", severity: "warning", message: `Cerca del límite del plan: ${input.nearLimits.join(", ")}.` });
  }
  if (input.siteCount > 0 && input.lastPublishedAt === null) {
    alerts.push({ code: "NEVER_PUBLISHED", severity: "info", message: "Tiene sitios pero ninguna página publicada." });
  }
  return alerts;
}
