import { describe, expect, it } from "vitest";
import {
  compareTotals,
  compareValue,
  conversionRate,
  daysInRange,
  previousPeriod,
  reportCsv,
  reportQuerySchema,
  sameWindowLastYear,
  type ReportTotals,
} from "./index.js";

const totals = (overrides: Partial<ReportTotals> = {}): ReportTotals => ({
  pageViews: 0,
  visitors: 0,
  blockClicks: 0,
  whatsappClicks: 0,
  leads: 0,
  newContacts: 0,
  bookings: 0,
  orders: 0,
  revenue: 0,
  ...overrides,
});

describe("periodos", () => {
  it("cuenta los días con ambos extremos", () => {
    expect(daysInRange("2026-10-01", "2026-10-01")).toBe(1);
    expect(daysInRange("2026-10-01", "2026-10-07")).toBe(7);
    expect(daysInRange("2026-02-01", "2026-02-28")).toBe(28);
  });

  it("el periodo anterior es contiguo y de la misma duración", () => {
    expect(previousPeriod({ from: "2026-10-08", to: "2026-10-14" })).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    // Cruza un año.
    expect(previousPeriod({ from: "2026-01-01", to: "2026-01-10" })).toEqual({ from: "2025-12-22", to: "2025-12-31" });
  });

  it("el mismo periodo del año anterior conserva las fechas y maneja el 29 de febrero", () => {
    expect(sameWindowLastYear({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2025-10-01", to: "2025-10-31" });
    expect(sameWindowLastYear({ from: "2028-02-29", to: "2028-03-05" })).toEqual({ from: "2027-02-28", to: "2027-03-05" });
  });
});

describe("compareValue", () => {
  it("calcula cambio y variación relativa con valores conocidos", () => {
    expect(compareValue(150, 100)).toEqual({ base: 100, change: 50, ratio: 0.5 });
    expect(compareValue(50, 100)).toEqual({ base: 100, change: -50, ratio: -0.5 });
    expect(compareValue(100, 100)).toEqual({ base: 100, change: 0, ratio: 0 });
  });

  it("sin base o con base 0 no inventa una variación relativa", () => {
    expect(compareValue(10, 0)).toEqual({ base: 0, change: 10, ratio: null });
    expect(compareValue(10, null)).toEqual({ base: null, change: null, ratio: null });
    expect(compareValue(null, 5)).toEqual({ base: 5, change: null, ratio: null });
  });
});

describe("compareTotals y conversión", () => {
  it("compara cada métrica contra las dos bases", () => {
    const current = totals({ pageViews: 200, leads: 10, visitors: 100 });
    const previous = totals({ pageViews: 100, leads: 10, visitors: 50 });
    const lastYear = totals({ pageViews: 0 });
    const compared = compareTotals(current, previous, lastYear);
    const views = compared.find((metric) => metric.key === "pageViews")!;
    expect(views.previous).toEqual({ base: 100, change: 100, ratio: 1 });
    expect(views.lastYear).toEqual({ base: 0, change: 200, ratio: null });
    expect(compared).toHaveLength(9);
    expect(compareTotals(current, null, null)[0]!.previous.change).toBeNull();
  });

  it("la conversión es contactos sobre visitantes, o nula sin visitantes", () => {
    expect(conversionRate({ leads: 10, visitors: 200 })).toBe(0.05);
    expect(conversionRate({ leads: 3, visitors: 0 })).toBeNull();
  });
});

describe("reportQuerySchema", () => {
  it("acepta un rango válido y rechaza fechas inexistentes, invertidas o demasiado largas", () => {
    expect(reportQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success).toBe(true);
    expect(reportQuerySchema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: "2026-10-31", to: "2026-10-01" }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: "2024-01-01", to: "2026-01-01" }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: "01/10/2026", to: "2026-10-02" }).success).toBe(false);
  });
});

describe("reportCsv", () => {
  const metrics = compareTotals(totals({ pageViews: 120, revenue: 45000 }), totals({ pageViews: 100 }), null);

  it("trae las métricas con su comparación y no es una fórmula aunque el nombre lo sea", () => {
    const csv = reportCsv({
      organizationName: "=HYPERLINK(\"http://x.test\")",
      period: { from: "2026-10-01", to: "2026-10-31" },
      previousPeriod: { from: "2026-08-31", to: "2026-09-30" },
      lastYearPeriod: { from: "2025-10-01", to: "2025-10-31" },
      metrics,
      conversion: { value: 0.05, previous: null, lastYear: null },
      topBlocks: [{ label: "+cmd|' /C calc'!A0", detail: "Inicio", value: 12 }],
    });
    const lines = csv.replace("﻿", "").split("\r\n");
    expect(lines[0]).toMatch(/^Informe;"?'=HYPERLINK/);
    expect(lines.find((line) => line.startsWith("Visitas;120;100;20;20.0 %"))).toBeDefined();
    expect(lines.find((line) => line.startsWith("Ventas pagadas;45000"))).toBeDefined();
    expect(lines.some((line) => line.startsWith("'+cmd"))).toBe(true);
    expect(csv.startsWith("﻿")).toBe(true);
  });
});
