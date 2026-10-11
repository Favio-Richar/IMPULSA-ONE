import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_PERIOD_DAYS,
  createMembershipPlanSchema,
  memberHasAccess,
  nextPeriodStart,
  paidUntil,
  purchaseGrantsAccess,
  startMembershipCheckoutSchema,
  updateMembershipPlanSchema,
  type PurchaseForAccess,
} from "./index.js";

const NOW = new Date("2026-10-11T12:00:00Z");
const day = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);
const paid = (overrides: Partial<PurchaseForAccess> = {}): PurchaseForAccess => ({
  status: "PAID",
  paymentStatus: "approved",
  amount: 5000,
  refundedAmount: 0,
  periodEnd: day(10),
  ...overrides,
});

describe("planes de membresía — validación", () => {
  it("crea un plan con moneda en mayúsculas y nombre saneado", () => {
    const plan = createMembershipPlanSchema.parse({ name: `  Club${String.fromCharCode(0)} Premium `, priceAmount: 9990, priceCurrency: "clp", period: "MONTHLY" });
    expect(plan).toMatchObject({ name: "Club Premium", priceAmount: 9990, priceCurrency: "CLP", period: "MONTHLY" });
    expect(createMembershipPlanSchema.parse({ name: "Club", priceAmount: 1, period: "YEARLY" }).priceCurrency).toBe("CLP");
  });

  it("el precio es un entero positivo y acotado (nunca decimal ni cero)", () => {
    for (const priceAmount of [0, -1, 9.5, 100_000_001, Number.NaN]) {
      expect(createMembershipPlanSchema.safeParse({ name: "Club", priceAmount, period: "MONTHLY" }).success, String(priceAmount)).toBe(false);
    }
    expect(createMembershipPlanSchema.safeParse({ name: "Club", priceAmount: "9990", period: "MONTHLY" }).success).toBe(false);
  });

  it("rechaza periodos y monedas inválidos, nombres vacíos y campos extra", () => {
    expect(createMembershipPlanSchema.safeParse({ name: "Club", priceAmount: 100, period: "WEEKLY" }).success).toBe(false);
    expect(createMembershipPlanSchema.safeParse({ name: "Club", priceAmount: 100, period: "MONTHLY", priceCurrency: "PESOS" }).success).toBe(false);
    expect(createMembershipPlanSchema.safeParse({ name: " ", priceAmount: 100, period: "MONTHLY" }).success).toBe(false);
    expect(createMembershipPlanSchema.safeParse({ name: "Club", priceAmount: 100, period: "MONTHLY", status: "ARCHIVED" }).success).toBe(false);
  });

  it("actualizar exige al menos un campo y permite quitar la descripción", () => {
    expect(updateMembershipPlanSchema.safeParse({}).success).toBe(false);
    expect(updateMembershipPlanSchema.parse({ description: null })).toEqual({ description: null });
  });

  it("quien compra manda solo correo y nombre: el precio no es del cliente", () => {
    expect(startMembershipCheckoutSchema.parse({ email: "A@B.cl" })).toEqual({ email: "a@b.cl" });
    expect(startMembershipCheckoutSchema.safeParse({ email: "a@b.cl", priceAmount: 1 }).success).toBe(false);
  });

  it("los periodos son de 30 y 365 días", () => {
    expect(MEMBERSHIP_PERIOD_DAYS).toEqual({ MONTHLY: 30, YEARLY: 365 });
  });
});

describe("acceso por periodo pagado", () => {
  it("un miembro invitado entra siempre; uno que compró, solo con un periodo vigente y aprobado", () => {
    expect(memberHasAccess({ source: "INVITED" }, [], NOW)).toBe(true);
    expect(memberHasAccess({ source: "PURCHASED" }, [], NOW)).toBe(false);
    expect(memberHasAccess({ source: "PURCHASED" }, [paid()], NOW)).toBe(true);
  });

  it("el periodo vencido, el pago pendiente y el expirado no dan acceso", () => {
    expect(purchaseGrantsAccess(paid({ periodEnd: day(-1) }), NOW)).toBe(false);
    expect(purchaseGrantsAccess(paid({ periodEnd: NOW }), NOW)).toBe(false);
    expect(purchaseGrantsAccess(paid({ status: "PENDING", paymentStatus: null, periodEnd: null }), NOW)).toBe(false);
    expect(purchaseGrantsAccess(paid({ status: "EXPIRED" }), NOW)).toBe(false);
  });

  it("un reembolso total, un contracargo o un reclamo cortan el acceso; uno parcial no", () => {
    expect(purchaseGrantsAccess(paid({ refundedAmount: 5000, paymentStatus: "refunded" }), NOW)).toBe(false);
    expect(purchaseGrantsAccess(paid({ paymentStatus: "charged_back" }), NOW)).toBe(false);
    expect(purchaseGrantsAccess(paid({ paymentStatus: "in_mediation" }), NOW)).toBe(false);
    expect(purchaseGrantsAccess(paid({ refundedAmount: 1000 }), NOW)).toBe(true);
  });

  it("los periodos se apilan: renovar antes empieza donde termina el vigente", () => {
    expect(nextPeriodStart([], NOW)).toEqual(NOW);
    expect(nextPeriodStart([paid({ periodEnd: day(10) })], NOW)).toEqual(day(10));
    expect(nextPeriodStart([paid({ periodEnd: day(10) }), paid({ periodEnd: day(40) })], NOW)).toEqual(day(40));
    // Uno vencido no cuenta: empieza ahora.
    expect(nextPeriodStart([paid({ periodEnd: day(-5) })], NOW)).toEqual(NOW);
    expect(paidUntil([paid({ periodEnd: day(-5) })], NOW)).toBeNull();
  });
});
