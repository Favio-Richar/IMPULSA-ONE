import { z } from "zod";

// Planes y límites (F4.1, PM §7.5). Mismo criterio que el catálogo de temas (F2.5): el catálogo
// vive tipado acá, el seed lo aplica a la tabla `plans`, y el servidor valida con este esquema lo
// que lee de la columna JSON — `Plan.limits` nunca se usa como JSON libre.

/** Un límite: un entero ≥ 0, o `null` = sin límite. */
const limitValue = z.number().int().min(0).nullable();

export const planLimitsSchema = z.object({
  sites: limitValue,
  pagesPerSite: limitValue,
  forms: limitValue,
  /** Contactos creados a mano. Los que llegan por formulario público nunca se rechazan por límite
   *  (el visitante no tiene la culpa): se guardan y el exceso se muestra (F4.2). */
  contacts: limitValue,
  shortLinks: limitValue,
  qrCodes: limitValue,
  /** Miembros activos más invitaciones pendientes. */
  members: limitValue,
  /** Días de historial visibles en el dashboard de conversión (F3.7). */
  analyticsHistoryDays: limitValue,
  /** Existe en el catálogo pero no se aplica hasta que haya subida de archivos (decisión #7). */
  storageMb: limitValue,
  /** Correos de campañas por hora (F5.6). Un plan guardado antes de F5.6 no lo tiene: vale el
   *  mínimo (`DEFAULT_EMAILS_PER_HOUR`) hasta que el equipo lo ajuste. */
  emailsPerHour: limitValue.default(50),
  /** Solicitudes al asistente de IA por mes calendario (F6.2). Un plan guardado antes de F6.2 no lo
   *  tiene: vale el mínimo (`DEFAULT_AI_REQUESTS_PER_MONTH`) hasta que el equipo lo ajuste. */
  aiRequestsPerMonth: limitValue.default(20),
  /** Pruebas A/B en curso a la vez en toda la organización (F6.5). Un plan guardado antes de F6.5
   *  no lo tiene: vale el mínimo (`DEFAULT_AB_TESTS_RUNNING`) hasta que el equipo lo ajuste. */
  abTestsRunning: limitValue.default(1),
});

export const DEFAULT_AB_TESTS_RUNNING = 1;

export const DEFAULT_AI_REQUESTS_PER_MONTH = 20;

export const DEFAULT_EMAILS_PER_HOUR = 50;

export type PlanLimits = z.infer<typeof planLimitsSchema>;
export type PlanLimitKey = keyof PlanLimits;

/** Límites de nivel organización que se cuentan contra su uso real (F4.2/F4.3). `pagesPerSite` también
 *  se aplica, pero por sitio; `analyticsHistoryDays` acota una consulta, no una creación. */
export const ENFORCED_LIMIT_KEYS = [
  "sites",
  "forms",
  "contacts",
  "shortLinks",
  "qrCodes",
  "members",
] as const satisfies readonly PlanLimitKey[];
export type EnforcedLimitKey = (typeof ENFORCED_LIMIT_KEYS)[number];

export interface PlanCatalogEntry {
  code: string;
  name: string;
  /** Precio en la unidad mínima de la moneda (CLP no tiene decimales: pesos). Nunca float. */
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  sortOrder: number;
  limits: PlanLimits;
}

export const DEFAULT_PLAN_CODE = "free";

/**
 * **Valores PROVISORIOS.** Los límites exactos y los precios son la decisión pendiente #4 del
 * propietario (`REQUIREMENTS_TRACEABILITY.md` §15), y la moneda depende del mercado de lanzamiento
 * (#2; CLP por ahora, igual que el resto del proyecto asume Chile — ADR-004). Son números de
 * desarrollo para que el sistema de límites funcione de punta a punta, no una decisión comercial:
 * se corrigen acá (o desde la superadministración, F4.4) sin tocar ninguna otra línea de código.
 */
export const PLAN_CATALOG: readonly PlanCatalogEntry[] = [
  {
    code: DEFAULT_PLAN_CODE,
    name: "Gratis",
    priceMonthly: 0,
    priceYearly: 0,
    currency: "CLP",
    sortOrder: 0,
    limits: {
      sites: 1,
      pagesPerSite: 3,
      forms: 1,
      contacts: 100,
      shortLinks: 5,
      qrCodes: 5,
      members: 1,
      analyticsHistoryDays: 30,
      storageMb: 200,
      emailsPerHour: 50,
      aiRequestsPerMonth: 20,
      abTestsRunning: 1,
    },
  },
  {
    code: "profesional",
    name: "Profesional",
    priceMonthly: 7_990,
    priceYearly: 79_900,
    currency: "CLP",
    sortOrder: 1,
    limits: {
      sites: 3,
      pagesPerSite: 20,
      forms: 10,
      contacts: 2_000,
      shortLinks: 100,
      qrCodes: 100,
      members: 3,
      analyticsHistoryDays: 365,
      storageMb: 2_000,
      emailsPerHour: 300,
      aiRequestsPerMonth: 300,
      abTestsRunning: 3,
    },
  },
  {
    code: "negocio",
    name: "Negocio",
    priceMonthly: 19_990,
    priceYearly: 199_900,
    currency: "CLP",
    sortOrder: 2,
    limits: {
      sites: 10,
      pagesPerSite: 50,
      forms: 50,
      contacts: 20_000,
      shortLinks: 1_000,
      qrCodes: 1_000,
      members: 10,
      analyticsHistoryDays: 730,
      storageMb: 10_000,
      emailsPerHour: 1_000,
      aiRequestsPerMonth: 1_500,
      abTestsRunning: 10,
    },
  },
  {
    code: "agencia",
    name: "Agencia",
    priceMonthly: 49_990,
    priceYearly: 499_900,
    currency: "CLP",
    sortOrder: 3,
    limits: {
      sites: 50,
      pagesPerSite: 100,
      forms: null,
      contacts: 100_000,
      shortLinks: null,
      qrCodes: null,
      members: 50,
      analyticsHistoryDays: 730,
      storageMb: 50_000,
      emailsPerHour: 5_000,
      aiRequestsPerMonth: 5_000,
      abTestsRunning: 30,
    },
  },
];
