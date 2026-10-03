import { describe, expect, it } from "vitest";
import { ENFORCED_LIMIT_KEYS, PLAN_CATALOG, planLimitsSchema } from "@impulza/validation";
import { planLimitsResponse, planUsageResponse } from "./plans.js";

// `contracts` no depende de `validation` en producción y duplica la forma de los límites (ver plans.ts): esta prueba es
// la que avisa cuando alguien agrega un límite en un lado y se olvida del otro (F9.3 agregó `clients`).
describe("plans contracts parity", () => {
  it("planLimitsResponse tiene las mismas claves que planLimitsSchema", () => {
    expect(Object.keys(planLimitsResponse.shape).sort()).toEqual(Object.keys(planLimitsSchema.shape).sort());
  });

  it("cada límite que el servidor hace cumplir tiene su uso en planUsageResponse", () => {
    for (const key of ENFORCED_LIMIT_KEYS) {
      expect(Object.keys(planUsageResponse.shape), `falta el uso de «${key}»`).toContain(key);
    }
  });

  it("los límites de cada plan del catálogo son una respuesta válida del contrato", () => {
    for (const plan of PLAN_CATALOG) {
      expect(planLimitsResponse.safeParse(plan.limits).success, `plan «${plan.code}»`).toBe(true);
    }
  });
});
