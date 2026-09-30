import { describe, expect, it } from "vitest";
import { parsePaymentOutcome, renewalDate, subscriptionStatusLabel, vatBreakdown, yearlySavings } from "./billing-text";

describe("billing-text", () => {
  it("neto + IVA suman exactamente el total, igual que el servidor", () => {
    expect(vatBreakdown(7_990)).toEqual({ net: 6_714, vat: 1_276 });
    for (const total of [1, 19_990, 79_900, 199_900]) {
      const { net, vat } = vatBreakdown(total);
      expect(net + vat).toBe(total);
    }
  });

  it("el ahorro anual se expresa en meses gratis, y no se inventa si no existe", () => {
    expect(yearlySavings(7_990, 79_900)).toEqual({ amount: 15_980, months: 2 });
    expect(yearlySavings(0, 0)).toBeNull();
    expect(yearlySavings(10_000, 130_000)).toBeNull();
  });

  it("la próxima renovación no se salta febrero", () => {
    const next = renewalDate(new Date(2027, 0, 31), "MONTHLY");
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2027, 1, 28]);
  });

  it("solo acepta resultados de pago conocidos en la URL", () => {
    expect(parsePaymentOutcome("exito")).toBe("exito");
    expect(parsePaymentOutcome("<script>")).toBeNull();
    expect(parsePaymentOutcome(null)).toBeNull();
  });

  it("un plan cancelado dice hasta cuándo sigue activo", () => {
    const label = subscriptionStatusLabel({ status: "ACTIVE", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-10-29T15:00:00.000Z", nextChargeAt: null });
    expect(label).toMatchObject({ tone: "warning", label: "Cancelado" });
    expect(label.detail).toContain("29 de octubre de 2026");
  });
});
