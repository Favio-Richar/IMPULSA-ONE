import { describe, expect, it } from "vitest";
import { csvCell, csvRow, currentSantiagoMonth, monthlyRecurringAmount, santiagoMonthRange } from "./index.js";

describe("santiagoMonthRange", () => {
  it("en invierno Chile está en UTC−4", () => {
    const { from, to } = santiagoMonthRange("2026-07");
    expect(from.toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("en verano está en UTC−3, y diciembre cierra en enero del año siguiente", () => {
    const { from, to } = santiagoMonthRange("2026-12");
    expect(from.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });

  it("un mes con cambio de hora no pierde ni duplica un instante", () => {
    // Septiembre: entra el horario de verano. El fin de un mes es exactamente el inicio del siguiente.
    expect(santiagoMonthRange("2026-09").to.getTime()).toBe(santiagoMonthRange("2026-10").from.getTime());
    expect(santiagoMonthRange("2026-03").to.getTime()).toBe(santiagoMonthRange("2026-04").from.getTime());
  });

  it("rechaza meses mal formados", () => {
    expect(() => santiagoMonthRange("2026-7")).toThrow();
  });

  it("el mes en curso se calcula en hora de Chile, no en UTC", () => {
    // 1 de octubre 01:00 UTC = 30 de septiembre 22:00 en Chile (UTC−3).
    expect(currentSantiagoMonth(new Date("2026-10-01T01:00:00Z"))).toBe("2026-09");
  });
});

describe("monthlyRecurringAmount", () => {
  it("anual se reparte en 12 meses", () => {
    expect(monthlyRecurringAmount({ priceMonthly: 7_990, priceYearly: 79_900 }, "MONTHLY")).toBe(7_990);
    expect(monthlyRecurringAmount({ priceMonthly: 7_990, priceYearly: 79_900 }, "YEARLY")).toBe(6_658);
  });
});

describe("csvCell", () => {
  it("neutraliza fórmulas en textos que escribe el cliente", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+56 9 1234")).toBe(`"'+56 9 1234"`);
    expect(csvCell("-1")).toBe(`"'-1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
  });

  it("los números van tal cual y los textos normales entre comillas", () => {
    expect(csvRow(["Estudio \"Aurora\"", 7_990, null])).toBe(`"Estudio ""Aurora""",7990,`);
  });
});
