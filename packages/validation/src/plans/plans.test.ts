import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_CODE, ENFORCED_LIMIT_KEYS, PLAN_CATALOG, planLimitsSchema } from "./index.js";

describe("catálogo de planes (F4.1)", () => {
  it("cada plan cumple el esquema de límites y usa precios enteros", () => {
    for (const plan of PLAN_CATALOG) {
      expect(planLimitsSchema.safeParse(plan.limits).success, plan.code).toBe(true);
      expect(Number.isInteger(plan.priceMonthly), plan.code).toBe(true);
      expect(Number.isInteger(plan.priceYearly), plan.code).toBe(true);
    }
  });

  it("existe exactamente un plan por defecto y es gratuito", () => {
    const defaults = PLAN_CATALOG.filter((plan) => plan.code === DEFAULT_PLAN_CODE);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.priceMonthly).toBe(0);
  });

  it("subir de plan nunca reduce un límite", () => {
    const ordered = [...PLAN_CATALOG].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 1; i < ordered.length; i++) {
      for (const key of ENFORCED_LIMIT_KEYS) {
        const previous = ordered[i - 1]!.limits[key];
        const current = ordered[i]!.limits[key];
        // null = sin límite: siempre es "más" que cualquier número.
        if (current !== null) {
          expect(previous, `${ordered[i]!.code}.${key}`).not.toBeNull();
          expect(current, `${ordered[i]!.code}.${key}`).toBeGreaterThanOrEqual(previous!);
        }
      }
    }
  });

  it("rechaza límites negativos, decimales o faltantes", () => {
    const base = PLAN_CATALOG[0]!.limits;
    expect(planLimitsSchema.safeParse({ ...base, sites: -1 }).success).toBe(false);
    expect(planLimitsSchema.safeParse({ ...base, sites: 1.5 }).success).toBe(false);
    const missing: Partial<typeof base> = { ...base };
    delete missing.sites;
    expect(planLimitsSchema.safeParse(missing).success).toBe(false);
  });
});
