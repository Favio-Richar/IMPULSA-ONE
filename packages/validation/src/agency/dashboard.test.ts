import { describe, expect, it } from "vitest";
import {
  AGENCY_CLIENT_STATUSES,
  agencyDashboardQuerySchema,
  agencyOverviewQuerySchema,
  buildClientAlerts,
  countByStatus,
  countsTowardsTotals,
  dashboardRange,
  isNearLimit,
  usageRatio,
} from "../index.js";

describe("panel de agencia — rango de fechas", () => {
  it("termina hoy e incluye `days` días (UTC)", () => {
    expect(dashboardRange(7, new Date("2026-10-03T23:30:00.000Z"))).toEqual({ from: "2026-09-27", to: "2026-10-03" });
    expect(dashboardRange(1, new Date("2026-10-03T00:00:00.000Z"))).toEqual({ from: "2026-10-03", to: "2026-10-03" });
  });

  it("cruza el cambio de mes y de año", () => {
    expect(dashboardRange(30, new Date("2027-01-05T10:00:00.000Z"))).toEqual({ from: "2026-12-07", to: "2027-01-05" });
  });
});

describe("panel de agencia — consultas", () => {
  it("`days` solo acepta 7, 30 o 90 y por defecto es 30", () => {
    expect(agencyDashboardQuerySchema.parse({}).days).toBe(30);
    expect(agencyDashboardQuerySchema.parse({ days: "90" }).days).toBe(90);
    for (const bad of ["0", "15", "365", "abc", "-7"]) expect(agencyDashboardQuerySchema.safeParse({ days: bad }).success).toBe(false);
  });

  it("la tabla acota página, tamaño, orden y estado", () => {
    const ok = agencyOverviewQuerySchema.parse({});
    expect(ok).toMatchObject({ days: 30, sort: "createdAt", order: "desc", page: 1, pageSize: 20 });
    expect(agencyOverviewQuerySchema.safeParse({ pageSize: "51" }).success).toBe(false);
    expect(agencyOverviewQuerySchema.safeParse({ pageSize: "0" }).success).toBe(false);
    expect(agencyOverviewQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(agencyOverviewQuerySchema.safeParse({ sort: "pageViews" }).success).toBe(false);
    expect(agencyOverviewQuerySchema.safeParse({ status: "BORRADO" }).success).toBe(false);
    expect(agencyOverviewQuerySchema.safeParse({ status: "PAUSED", sort: "name", order: "asc" }).success).toBe(true);
    expect(agencyOverviewQuerySchema.parse({ search: "   " }).search).toBeUndefined();
    expect(agencyOverviewQuerySchema.parse({ search: "  Café  " }).search).toBe("Café");
    expect(agencyOverviewQuerySchema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
  });
});

describe("panel de agencia — totales", () => {
  it("cuenta por estado y deja en 0 los que no aparecen", () => {
    const counts = countByStatus(["ACTIVE", "ACTIVE", "PAUSED", "INVITED"]);
    expect(counts).toEqual({ INVITED: 1, ACTIVE: 2, PAUSED: 1, ARCHIVED: 0, TRANSFERRING: 0, ENDED: 0 });
    expect(Object.keys(counts).sort()).toEqual([...AGENCY_CLIENT_STATUSES].sort());
  });

  it("solo un cliente ACTIVE suma al consolidado", () => {
    for (const status of AGENCY_CLIENT_STATUSES) expect(countsTowardsTotals(status)).toBe(status === "ACTIVE");
  });
});

describe("panel de agencia — cupo del plan", () => {
  it("la proporción respeta los límites nulos y cero", () => {
    expect(usageRatio(5, null)).toBeNull();
    expect(usageRatio(5, 10)).toBe(0.5);
    expect(usageRatio(0, 0)).toBe(0);
    expect(usageRatio(1, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("«cerca del límite» empieza en 80 % y nunca con límite ilimitado", () => {
    expect(isNearLimit(79, 100)).toBe(false);
    expect(isNearLimit(80, 100)).toBe(true);
    expect(isNearLimit(120, 100)).toBe(true);
    expect(isNearLimit(1_000_000, null)).toBe(false);
  });
});

describe("panel de agencia — alertas", () => {
  const calm = { domainsFailed: 0, domainsPending: 0, nearLimits: [], publicHidden: false, lastPublishedAt: new Date(), siteCount: 1 };

  it("un cliente sano no tiene alertas", () => {
    expect(buildClientAlerts(calm)).toEqual([]);
  });

  it("van de más a menos graves", () => {
    const alerts = buildClientAlerts({ domainsFailed: 2, domainsPending: 1, nearLimits: ["sitios"], publicHidden: true, lastPublishedAt: null, siteCount: 3 });
    expect(alerts.map((alert) => alert.code)).toEqual(["DOMAIN_FAILED", "SITE_HIDDEN", "DOMAIN_PENDING", "NEAR_PLAN_LIMIT", "NEVER_PUBLISHED"]);
    expect(alerts[0]).toMatchObject({ severity: "critical", message: "2 dominios fallaron la verificación." });
    expect(buildClientAlerts({ ...calm, domainsPending: 1 })[0]?.message).toBe("1 dominio sin verificar.");
  });

  it("sin sitios no avisa de «nunca publicó»", () => {
    expect(buildClientAlerts({ ...calm, siteCount: 0, lastPublishedAt: null })).toEqual([]);
  });

  it("jamás habla de suscripción ni de pagos del cliente (límite duro del ADR-028)", () => {
    const every = buildClientAlerts({ domainsFailed: 1, domainsPending: 1, nearLimits: ["sitios", "contactos"], publicHidden: true, lastPublishedAt: null, siteCount: 1 });
    for (const alert of every) expect(alert.message.toLowerCase()).not.toMatch(/suscrip|pago|cobro|tarjeta/);
  });
});
