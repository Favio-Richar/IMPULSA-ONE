import { describe, expect, it } from "vitest";
import { changeBillingSchema, planBillingChange } from "../index.js";

describe("cambio de facturación — reglas", () => {
  const base = { ownerAccepted: true } as const;

  it("pedir el modo que ya tiene no hace nada, venga de quien venga", () => {
    for (const requester of ["AGENCY", "OWNER"] as const) {
      for (const mode of ["CLIENT_PAYS", "AGENCY_PAYS"] as const) {
        expect(planBillingChange({ ...base, current: mode, requested: mode, requester })).toEqual({ kind: "noop" });
      }
    }
  });

  it("la agencia propone y el propietario debe confirmar, en los dos sentidos", () => {
    expect(planBillingChange({ ...base, current: "CLIENT_PAYS", requested: "AGENCY_PAYS", requester: "AGENCY" })).toEqual({ kind: "needs_owner" });
    expect(planBillingChange({ ...base, current: "AGENCY_PAYS", requested: "CLIENT_PAYS", requester: "AGENCY" })).toEqual({ kind: "needs_owner" });
  });

  it("el propietario puede volver a pagar él y se aplica al instante", () => {
    expect(planBillingChange({ ...base, current: "AGENCY_PAYS", requested: "CLIENT_PAYS", requester: "OWNER" })).toEqual({ kind: "apply_now", reason: "owner_request" });
  });

  it("el propietario no puede pedir que la agencia pague", () => {
    const plan = planBillingChange({ ...base, current: "CLIENT_PAYS", requested: "AGENCY_PAYS", requester: "OWNER" });
    expect(plan.kind).toBe("forbidden");
  });

  it("sin propietario que confirme (cliente creado por la agencia, invitación sin aceptar) la agencia decide", () => {
    expect(planBillingChange({ current: "CLIENT_PAYS", requested: "AGENCY_PAYS", requester: "AGENCY", ownerAccepted: false })).toEqual({ kind: "apply_now", reason: "no_owner_yet" });
  });

  it("el cuerpo solo acepta los dos modos", () => {
    expect(changeBillingSchema.safeParse({ billingMode: "AGENCY_PAYS" }).success).toBe(true);
    expect(changeBillingSchema.safeParse({ billingMode: "CLIENT_PAYS" }).success).toBe(true);
    for (const bad of [{}, { billingMode: "FREE" }, { billingMode: 1 }, { billingMode: null }]) expect(changeBillingSchema.safeParse(bad).success).toBe(false);
  });
});
