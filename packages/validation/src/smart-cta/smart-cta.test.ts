import { describe, expect, it } from "vitest";
import { DEFAULT_WEEKLY_HOURS } from "../bookings/index.js";
import { evaluateSmartCta, isWithinHours, needsBookingAvailability, smartCtaSchema, type SmartCtaContext } from "./index.js";

const ID = "11111111-1111-4111-8111-111111111111";
const hours = { timeZone: "America/Santiago", weeklyHours: DEFAULT_WEEKLY_HOURS };

function context(overrides: Partial<SmartCtaContext> = {}): SmartCtaContext {
  return { now: new Date("2026-09-29T13:00:00Z"), device: "mobile", utm: {}, hours, bookingsAvailable: true, ...overrides };
}

describe("Smart CTA (F6.6)", () => {
  it("el horario se evalúa en la zona del negocio, con sus tramos y días", () => {
    // Martes 29-09-2026 en Santiago (UTC-3 con horario de verano).
    expect(isWithinHours(new Date("2026-09-29T13:00:00Z"), hours.timeZone, hours.weeklyHours)).toBe(true); // 10:00
    expect(isWithinHours(new Date("2026-09-29T17:00:00Z"), hours.timeZone, hours.weeklyHours)).toBe(false); // 14:00, entre tramos
    expect(isWithinHours(new Date("2026-09-29T16:00:00Z"), hours.timeZone, hours.weeklyHours)).toBe(false); // 13:00, el fin no incluye
    expect(isWithinHours(new Date("2026-09-27T15:00:00Z"), hours.timeZone, hours.weeklyHours)).toBe(false); // domingo
  });

  it("gana la primera regla que se cumple; sin ninguna, se queda la acción de siempre", () => {
    const rules = [
      { condition: { kind: "utm_campaign" as const, value: "black-friday" }, position: 4 },
      { condition: { kind: "outside_hours" as const }, position: 2 },
      { condition: { kind: "device" as const, device: "desktop" as const }, position: 3 },
    ];
    expect(evaluateSmartCta(rules, context())).toBeNull();
    expect(evaluateSmartCta(rules, context({ now: new Date("2026-09-29T17:00:00Z") }))).toBe(2);
    expect(evaluateSmartCta(rules, context({ device: "desktop" }))).toBe(3);
    expect(evaluateSmartCta(rules, context({ utm: { campaign: " Black Friday " }, now: new Date("2026-09-29T17:00:00Z") }))).toBe(4);
  });

  it("sin horario configurado o sin saber si hay reservas, esas reglas no se cumplen (nunca se adivina)", () => {
    const rules = [
      { condition: { kind: "outside_hours" as const }, position: 1 },
      { condition: { kind: "bookings_unavailable" as const }, position: 2 },
    ];
    expect(evaluateSmartCta(rules, context({ hours: null, bookingsAvailable: null }))).toBeNull();
    expect(evaluateSmartCta(rules, context({ bookingsAvailable: false }))).toBe(2);
    expect(needsBookingAvailability(rules)).toBe(true);
    expect(needsBookingAvailability([rules[0]!])).toBe(false);
  });

  it("las reglas son de un catálogo cerrado, con tope y valores de campaña normalizados", () => {
    expect(smartCtaSchema.parse({ rules: [{ condition: { kind: "utm_source", value: "  Instagram " }, blockId: ID }] }).rules[0]!.condition).toEqual({ kind: "utm_source", value: "instagram" });
    expect(smartCtaSchema.safeParse({ rules: [{ condition: { kind: "country", value: "CL" }, blockId: ID }] }).success).toBe(false);
    expect(smartCtaSchema.safeParse({ rules: [{ condition: { kind: "device", device: "watch" }, blockId: ID }] }).success).toBe(false);
    expect(smartCtaSchema.safeParse({ rules: Array(6).fill({ condition: { kind: "outside_hours" }, blockId: ID }) }).success).toBe(false);
    expect(smartCtaSchema.parse({ rules: [] })).toEqual({ rules: [] });
  });
});
