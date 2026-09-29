import { DEFAULT_WEEKLY_HOURS } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { applySmartCta, parseSmartCtaRules, smartCtaNeedsBookings } from "./smart-cta";

const blocks = [
  { position: 0, type: "profile", primary: false },
  { position: 1, type: "booking", primary: true },
  { position: 2, type: "whatsapp", primary: false },
];
const data = {
  rules: [
    { condition: { kind: "bookings_unavailable" }, position: 2 },
    { condition: { kind: "outside_hours" }, position: 2 },
    { condition: { kind: "condicion_del_futuro" }, position: 1 },
  ],
  hours: { timeZone: "America/Santiago", weeklyHours: DEFAULT_WEEKLY_HOURS },
};
const context = { now: new Date("2026-09-29T13:00:00Z"), device: "mobile" as const, utm: {}, bookingsAvailable: true };

describe("Smart CTA en el sitio público (F6.6)", () => {
  it("dentro de horario y con reservas, se queda la acción principal de siempre", () => {
    expect(applySmartCta(blocks, data, context)).toEqual(blocks);
  });

  it("fuera de horario o sin horas para reservar, pasa a ser principal el botón de la regla", () => {
    const afterHours = applySmartCta(blocks, data, { ...context, now: new Date("2026-09-30T02:00:00Z") });
    expect(afterHours.map((block) => block.primary)).toEqual([false, false, true]);
    expect(applySmartCta(blocks, data, { ...context, bookingsAvailable: false }).find((block) => block.primary)?.position).toBe(2);
  });

  it("una condición que este despliegue no conoce se ignora, y una posición que no está no cambia nada", () => {
    expect(parseSmartCtaRules(data)).toHaveLength(2);
    expect(applySmartCta(blocks, { rules: [{ condition: { kind: "device", device: "mobile" }, position: 9 }], hours: null }, context)).toEqual(blocks);
    expect(applySmartCta(blocks, undefined, context)).toBe(blocks);
    expect(smartCtaNeedsBookings(data)).toBe(true);
    expect(smartCtaNeedsBookings(undefined)).toBe(false);
  });
});
