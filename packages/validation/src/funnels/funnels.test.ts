import { describe, expect, it } from "vitest";
import {
  createFunnelSchema,
  funnelReportQuerySchema,
  funnelStepSchema,
  funnelStepsSchema,
  SUGGESTED_FUNNEL,
  updateFunnelSchema,
} from "./index.js";

const PAGE = "9a0b4d0e-7a8c-4b0e-9d7a-1f2e3d4c5b6a";

function paths(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }): string[] {
  return result.success ? [] : result.error!.issues.map((issue) => issue.path.join("."));
}

describe("funnelStepSchema (F7.6)", () => {
  it("acepta un paso con varios eventos y sin sujeto", () => {
    expect(funnelStepSchema.parse({ label: "Contacto", events: ["lead_created", "booking_created"] })).toEqual({
      label: "Contacto",
      events: ["lead_created", "booking_created"],
      subjectId: null,
    });
  });

  it("acepta una página concreta solo en un paso de una única vista de página o clic en bloque", () => {
    expect(funnelStepSchema.safeParse({ label: "Precios", events: ["page_view"], subjectId: PAGE }).success).toBe(true);
    expect(funnelStepSchema.safeParse({ label: "Botón", events: ["block_click"], subjectId: PAGE }).success).toBe(true);
    expect(paths(funnelStepSchema.safeParse({ label: "x", events: ["page_view", "block_click"], subjectId: PAGE }))).toContain("subjectId");
    expect(paths(funnelStepSchema.safeParse({ label: "x", events: ["order_created"], subjectId: PAGE }))).toContain("subjectId");
  });

  it("rechaza eventos fuera del catálogo, repetidos, vacíos o demasiados", () => {
    expect(paths(funnelStepSchema.safeParse({ label: "x", events: ["purchase"] }))).toContain("events.0");
    expect(paths(funnelStepSchema.safeParse({ label: "x", events: ["page_view", "page_view"] }))).toContain("events");
    expect(paths(funnelStepSchema.safeParse({ label: "x", events: [] }))).toContain("events");
    expect(
      paths(funnelStepSchema.safeParse({ label: "x", events: ["page_view", "block_click", "whatsapp_click", "form_submit", "lead_created"] })),
    ).toContain("events");
  });

  it("exige un nombre de paso y un sujeto con forma de uuid", () => {
    expect(paths(funnelStepSchema.safeParse({ label: "  ", events: ["page_view"] }))).toContain("label");
    expect(paths(funnelStepSchema.safeParse({ label: "x", events: ["page_view"], subjectId: "inicio" }))).toContain("subjectId");
  });
});

describe("funnelStepsSchema y embudo", () => {
  const step = { label: "Paso", events: ["page_view"] };

  it("exige de 2 a 6 pasos", () => {
    expect(funnelStepsSchema.safeParse([step]).success).toBe(false);
    expect(funnelStepsSchema.safeParse([step, step]).success).toBe(true);
    expect(funnelStepsSchema.safeParse(Array.from({ length: 7 }, () => step)).success).toBe(false);
  });

  it("el embudo sugerido es válido y termina en el pago", () => {
    expect(createFunnelSchema.safeParse(SUGGESTED_FUNNEL).success).toBe(true);
    expect(SUGGESTED_FUNNEL.steps.at(-1)?.events).toEqual(["payment"]);
  });

  it("al editar pide al menos un campo", () => {
    expect(updateFunnelSchema.safeParse({}).success).toBe(false);
    expect(updateFunnelSchema.safeParse({ name: "Nuevo nombre" }).success).toBe(true);
  });
});

describe("funnelReportQuerySchema", () => {
  it("acepta un rango válido con dispositivo opcional", () => {
    expect(funnelReportQuerySchema.safeParse({ from: "2026-09-01", to: "2026-09-30", device: "mobile" }).success).toBe(true);
  });

  it("rechaza un rango invertido, demasiado largo o un dispositivo desconocido", () => {
    expect(paths(funnelReportQuerySchema.safeParse({ from: "2026-09-30", to: "2026-09-01" }))).toContain("to");
    expect(paths(funnelReportQuerySchema.safeParse({ from: "2025-01-01", to: "2026-09-30" }))).toContain("to");
    expect(paths(funnelReportQuerySchema.safeParse({ from: "2026-09-01", to: "2026-09-30", device: "tv" }))).toContain("device");
  });
});
