import { describe, expect, it } from "vitest";
import type { AnalyticsEventJob } from "./job.js";
import { metricsForEvent, periodFor } from "./metrics.js";
import { retentionCutoff } from "./processor.js";

function job(overrides: Partial<AnalyticsEventJob> = {}): AnalyticsEventJob {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    siteId: null,
    type: "page_view",
    anonymizedVisitorId: null,
    device: null,
    geoCountry: null,
    geoCity: null,
    utm: null,
    subjectId: null,
    idempotencyKey: null,
    occurredAt: "2026-09-23T12:00:00.000Z",
    ...overrides,
  };
}

describe("metricsForEvent", () => {
  it("sin dimensiones, solo el total del tipo", () => {
    expect(metricsForEvent(job())).toEqual(["page_view"]);
  });

  it("agrega una métrica por cada dimensión presente", () => {
    const metrics = metricsForEvent(
      job({
        type: "block_click",
        device: "mobile",
        geoCountry: "cl",
        utm: { source: "Instagram", medium: "social", campaign: "Promo Septiembre" },
        subjectId: "00000000-0000-4000-8000-0000000000aa",
      }),
    );

    expect(metrics).toEqual([
      "block_click",
      "block_click:device:mobile",
      "block_click:country:CL",
      "block_click:utm_source:instagram",
      "block_click:utm_medium:social",
      "block_click:utm_campaign:promo-septiembre",
      "block_click:subject:00000000-0000-4000-8000-0000000000aa",
    ]);
  });

  it("recorta valores de UTM largos para acotar el tamaño de la clave", () => {
    const [, metric] = metricsForEvent(job({ utm: { source: "x".repeat(500) } }));
    expect(metric).toBe(`page_view:utm_source:${"x".repeat(80)}`);
  });
});

describe("periodFor / retentionCutoff", () => {
  it("el período es el día UTC", () => {
    expect(periodFor(new Date("2026-09-23T23:59:59.000Z"))).toBe("2026-09-23");
  });

  it("la retención de 14 meses corta en la fecha esperada", () => {
    expect(retentionCutoff(new Date("2026-09-23T00:00:00.000Z"), 14).toISOString()).toBe("2025-07-23T00:00:00.000Z");
  });
});
