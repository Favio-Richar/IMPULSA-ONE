import { describe, expect, it } from "vitest";
import { orderReceivedEmail } from "../catalog/index.js";
import { computeCouponDiscount, couponCodeSchema, couponRulesProblem, couponStatus, createCouponSchema, updateCouponSchema, type CouponRules } from "./index.js";

const rules = (overrides: Partial<CouponRules>): CouponRules => ({
  kind: "percent",
  percentOff: 10,
  amountOff: null,
  currency: null,
  minSubtotal: null,
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  ...overrides,
});

describe("cupones (F7.8b, ADR-023)", () => {
  it("el código se guarda en mayúsculas y sin espacios raros", () => {
    expect(couponCodeSchema.parse(" cyber-10 ")).toBe("CYBER-10");
    expect(couponCodeSchema.safeParse("ab").success).toBe(false);
    expect(couponCodeSchema.safeParse("con espacio").success).toBe(false);
    expect(couponCodeSchema.safeParse("-INICIA").success).toBe(false);
  });

  it("un porcentaje va de 1 a 100; un monto fijo exige monto y moneda; un mínimo exige moneda", () => {
    expect(createCouponSchema.parse({ code: "dia10", kind: "percent", percentOff: 10 })).toMatchObject({ code: "DIA10", active: true });
    expect(createCouponSchema.safeParse({ code: "DIA0", kind: "percent", percentOff: 0 }).success).toBe(false);
    expect(createCouponSchema.safeParse({ code: "DIA", kind: "percent" }).error?.issues[0]?.path).toEqual(["percentOff"]);
    expect(createCouponSchema.safeParse({ code: "MIL", kind: "fixed", amountOff: 1000 }).error?.issues[0]?.path).toEqual(["currency"]);
    expect(createCouponSchema.parse({ code: "MIL", kind: "fixed", amountOff: 1000, currency: "clp" }).currency).toBe("CLP");
    expect(createCouponSchema.safeParse({ code: "MIN", kind: "percent", percentOff: 5, minSubtotal: 10000 }).success).toBe(false);
    expect(
      createCouponSchema.safeParse({ code: "VEN", kind: "percent", percentOff: 5, startsAt: "2026-11-02T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" }).error?.issues[0]?.path,
    ).toEqual(["endsAt"]);
  });

  it("las reglas combinadas detectan un cambio que deja el cupón incoherente (al editar)", () => {
    expect(couponRulesProblem(rules({}))).toBeNull();
    expect(couponRulesProblem(rules({ kind: "fixed", percentOff: null, amountOff: 500 }))).toEqual({ path: "currency", message: "Elige la moneda del descuento." });
    expect(updateCouponSchema.parse({ maxRedemptions: null, description: null })).toEqual({ maxRedemptions: null, description: null });
    expect(updateCouponSchema.safeParse({}).success).toBe(false);
  });

  it("el descuento: porcentaje hacia abajo, monto fijo sin pasar el subtotal, y nada si no aplica", () => {
    expect(computeCouponDiscount(rules({ percentOff: 15 }), 9990, "CLP")).toBe(1498);
    expect(computeCouponDiscount(rules({ percentOff: 100 }), 9990, "CLP")).toBe(9990);
    expect(computeCouponDiscount(rules({ kind: "fixed", percentOff: null, amountOff: 5000, currency: "CLP" }), 3000, "CLP")).toBe(3000);
    expect(computeCouponDiscount(rules({ kind: "fixed", percentOff: null, amountOff: 5000, currency: "CLP" }), 3000, "USD")).toBeNull();
    expect(computeCouponDiscount(rules({ minSubtotal: 20000, currency: "CLP" }), 19999, "CLP")).toBeNull();
    expect(computeCouponDiscount(rules({ minSubtotal: 20000, currency: "CLP" }), 20000, "CLP")).toBe(2000);
    // Un porcentaje sin moneda vale en cualquier moneda.
    expect(computeCouponDiscount(rules({ percentOff: 10 }), 1999, "USD")).toBe(199);
    expect(computeCouponDiscount(rules({}), 0, "CLP")).toBeNull();
  });

  it("el estado: pausado, agotado, vencido, programado o vigente (el fin es exclusivo)", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const base = { active: true, startsAt: null, endsAt: null, maxRedemptions: null, redemptionCount: 0 };
    expect(couponStatus(base, now)).toBe("active");
    expect(couponStatus({ ...base, active: false }, now)).toBe("paused");
    expect(couponStatus({ ...base, maxRedemptions: 3, redemptionCount: 3 }, now)).toBe("exhausted");
    expect(couponStatus({ ...base, endsAt: "2026-11-01T12:00:00Z" }, now)).toBe("expired");
    expect(couponStatus({ ...base, startsAt: "2026-11-02T00:00:00Z" }, now)).toBe("scheduled");
  });

  it("el correo del pedido muestra el descuento con su código, antes del total", () => {
    const text = orderReceivedEmail({
      siteName: "Tienda",
      productName: "Polera",
      quantity: 2,
      unitPriceAmount: 10000,
      totalAmount: 18000,
      priceCurrency: "CLP",
      paymentUrl: null,
      discountAmount: 2000,
      couponCode: "DIA10",
    }).text;
    expect(text).toContain("Descuento (DIA10): −$2.000\nTotal: $18.000");
    const plain = orderReceivedEmail({ siteName: "Tienda", productName: "Polera", quantity: 1, unitPriceAmount: 10000, totalAmount: 10000, priceCurrency: "CLP", paymentUrl: null }).text;
    expect(plain).not.toContain("Descuento");
  });
});
