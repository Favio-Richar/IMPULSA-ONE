import { describe, expect, it } from "vitest";
import { aiInsightsRequestSchema, buildInsightsDigest, INSIGHTS_MIN_VISITORS, insightsOutputSchema, type InsightsPeriodInput } from "./insights.js";

function period(visitors: number, overrides: Partial<InsightsPeriodInput["totals"]> = {}, from = "2026-09-01"): InsightsPeriodInput {
  return {
    range: { from, to: "2026-09-30" },
    totals: { pageViews: visitors * 2, visitors, blockClicks: Math.floor(visitors / 2), whatsappClicks: 0, formSubmits: 0, leads: 0, newContacts: 0, ...overrides },
    conversionRate: visitors > 0 ? (overrides.leads ?? 0) / visitors : null,
    devices: [{ key: "mobile", value: visitors }],
    utmSources: [{ key: "instagram", value: visitors }],
    utmCampaigns: [],
    topBlocks: [
      { label: "Escríbenos", kind: "whatsapp", value: 10, deleted: false },
      { label: null, kind: null, value: 3, deleted: true },
    ],
  };
}

describe("IA comercial (F6.4)", () => {
  it("sin muestra suficiente no compara ni desglosa: el modelo no tiene con qué inventar una tendencia", () => {
    const { digest, sample } = buildInsightsDigest({ current: period(INSIGHTS_MIN_VISITORS - 1), previous: period(10), health: null });
    expect(sample).toEqual({ enough: false, visitors: INSIGHTS_MIN_VISITORS - 1, minimum: INSIGHTS_MIN_VISITORS, comparable: false });
    expect(digest).not.toHaveProperty("metricasAnteriores");
    expect(digest).not.toHaveProperty("variacionPorcentual");
    expect(digest).not.toHaveProperty("dispositivos");
    expect(digest.muestraSuficiente).toBe(false);
  });

  it("con muestra en los dos períodos compara, y sin muestra en el anterior no", () => {
    const both = buildInsightsDigest({ current: period(200, { leads: 10 }), previous: period(100, { leads: 5 }), health: null });
    expect(both.sample.comparable).toBe(true);
    expect(both.digest).toMatchObject({ variacionPorcentual: { visitantes: 100, leads: 100 }, metricas: { conversionPorcentaje: 5 } });

    const thinPrevious = buildInsightsDigest({ current: period(200), previous: period(20), health: null });
    expect(thinPrevious.sample).toMatchObject({ enough: true, comparable: false });
    expect(thinPrevious.digest).not.toHaveProperty("variacionPorcentual");
  });

  it("el resumen no lleva ids ni bloques eliminados, y trae los hallazgos de salud por código", () => {
    const { digest } = buildInsightsDigest({
      current: period(120),
      previous: null,
      health: { score: 68, findings: [{ code: "no_primary_action", severity: "warning", blockType: null }] },
    });
    const json = JSON.stringify(digest);
    expect(json).not.toMatch(/"id"/);
    expect(digest).toMatchObject({ bloquesMasUsados: [{ tipo: "whatsapp", texto: "Escríbenos", clics: 10 }], saludDePagina: { puntaje: 68 } });
    expect((digest as { bloquesMasUsados: unknown[] }).bloquesMasUsados).toHaveLength(1);
  });

  it("una acción solo puede apuntar a un hallazgo que la página tiene", () => {
    const schema = insightsOutputSchema(["no_primary_action", "no_primary_action"]);
    const action = { title: "Marca tu botón principal", reason: "Se destaca en el teléfono.", kind: "fix_page" };
    expect(schema.safeParse({ summary: "Bien.", actions: [{ ...action, findingCode: "no_primary_action" }] }).success).toBe(true);
    expect(schema.safeParse({ summary: "Bien.", actions: [{ ...action, findingCode: "seo_missing" }] }).success).toBe(false);
    expect(insightsOutputSchema([]).safeParse({ summary: "Bien.", actions: [{ ...action, findingCode: "no_primary_action" }] }).success).toBe(false);
    expect(insightsOutputSchema([]).safeParse({ summary: "Bien.", actions: [] }).success).toBe(false);
  });

  it("el período pedido es de la lista cerrada", () => {
    expect(aiInsightsRequestSchema.safeParse({ days: 30 }).success).toBe(true);
    expect(aiInsightsRequestSchema.safeParse({ days: 365 }).success).toBe(false);
  });
});
