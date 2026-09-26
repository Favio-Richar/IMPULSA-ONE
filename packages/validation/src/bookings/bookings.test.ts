import { describe, expect, it } from "vitest";
import {
  availableSlots,
  bookableServiceSchema,
  bookingBlackoutSchema,
  bookingSettingsSchema,
  DEFAULT_BOOKING_SETTINGS,
  isValidTimeZone,
  weeklyHoursSchema,
  zonedWallTimeToUtc,
  type AvailabilityInput,
} from "./index.js";

const TZ = "America/Santiago";
const EMPTY = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

function input(overrides: Partial<AvailabilityInput>): AvailabilityInput {
  return {
    timeZone: TZ,
    weeklyHours: EMPTY,
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    maxAdvanceDays: 365,
    now: new Date("2026-08-01T00:00:00Z"),
    fromDate: "2026-10-05",
    days: 1,
    busy: [],
    ...overrides,
  };
}

describe("zona horaria (F5.1)", () => {
  it("valida zonas IANA", () => {
    expect(isValidTimeZone("America/Santiago")).toBe(true);
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
    expect(isValidTimeZone("Marte/Base")).toBe(false);
    expect(isValidTimeZone("../../etc")).toBe(false);
  });

  it("una hora que no existe (salto de septiembre en Chile) es null; una que ocurre dos veces, la primera", () => {
    expect(zonedWallTimeToUtc({ year: 2026, month: 9, day: 6, hour: 0, minute: 30 }, TZ)).toBeNull();
    expect(zonedWallTimeToUtc({ year: 2026, month: 9, day: 6, hour: 1, minute: 0 }, TZ)?.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    // 3 de abril de 2027, 23:30 ocurre a las 02:30Z (GMT-3) y otra vez a las 03:30Z (GMT-4).
    expect(zonedWallTimeToUtc({ year: 2027, month: 4, day: 3, hour: 23, minute: 30 }, TZ)?.toISOString()).toBe("2027-04-04T02:30:00.000Z");
  });
});

describe("horarios libres (F5.1)", () => {
  const monday = { ...EMPTY, mon: [{ start: "09:00", end: "12:00" }] };

  it("ofrece cada intervalo cuyo servicio completo cabe en el tramo, en la hora local del negocio", () => {
    const [day] = availableSlots(input({ weeklyHours: monday, durationMinutes: 45 }));
    // Octubre en Chile es GMT-3: 09:00 local = 12:00Z. 11:00 + 45 min cabe; 11:30 + 45 no.
    expect(day).toEqual({
      date: "2026-10-05",
      slots: ["2026-10-05T12:00:00.000Z", "2026-10-05T12:30:00.000Z", "2026-10-05T13:00:00.000Z", "2026-10-05T13:30:00.000Z", "2026-10-05T14:00:00.000Z"],
    });
  });

  it("un día sin tramos no ofrece nada", () => {
    expect(availableSlots(input({ weeklyHours: monday, fromDate: "2026-10-04" }))[0]!.slots).toEqual([]);
  });

  it("no se superpone con reservas ni bloqueos, y respeta el margen entre reservas", () => {
    // Reserva de 09:30 a 10:15 local.
    const busy = [{ start: new Date("2026-10-05T12:30:00Z"), end: new Date("2026-10-05T13:15:00Z") }];
    expect(availableSlots(input({ weeklyHours: monday, durationMinutes: 45, busy }))[0]!.slots).toEqual([
      "2026-10-05T13:30:00.000Z",
      "2026-10-05T14:00:00.000Z",
    ]);
    // Con 30 minutos de margen, 10:30 queda demasiado cerca.
    expect(availableSlots(input({ weeklyHours: monday, durationMinutes: 45, busy, bufferMinutes: 30 }))[0]!.slots).toEqual([
      "2026-10-05T14:00:00.000Z",
    ]);
  });

  it("respeta la anticipación mínima y el horizonte máximo", () => {
    const now = new Date("2026-10-05T12:10:00Z"); // 09:10 local
    expect(availableSlots(input({ weeklyHours: monday, durationMinutes: 45, now, minNoticeMinutes: 60 }))[0]!.slots).toEqual([
      "2026-10-05T13:30:00.000Z",
      "2026-10-05T14:00:00.000Z",
    ]);
    expect(availableSlots(input({ weeklyHours: monday, now: new Date("2026-10-01T00:00:00Z"), maxAdvanceDays: 1 }))[0]!.slots).toEqual([]);
  });

  it("salto de horario de verano: no ofrece horas que no existen y corta el día en el salto", () => {
    // Domingo 6/9/2026: de 00:00 a 00:59 no existe; desde la 01:00 es GMT-3.
    const sunday = { ...EMPTY, sun: [{ start: "00:00", end: "02:00" }] };
    expect(availableSlots(input({ weeklyHours: sunday, fromDate: "2026-09-06" }))[0]!.slots).toEqual([
      "2026-09-06T04:00:00.000Z",
      "2026-09-06T04:30:00.000Z",
    ]);
    // Sábado 5/9 hasta las 24:00 (que es el salto, 04:00Z): la última hora completa cabe.
    const saturday = { ...EMPTY, sat: [{ start: "22:00", end: "24:00" }] };
    expect(availableSlots(input({ weeklyHours: saturday, fromDate: "2026-09-05", durationMinutes: 60, slotIntervalMinutes: 60 }))[0]!.slots).toEqual([
      "2026-09-06T02:00:00.000Z",
      "2026-09-06T03:00:00.000Z",
    ]);
  });

  it("fin del horario de verano: la hora repetida no se ofrece dos veces", () => {
    const saturday = { ...EMPTY, sat: [{ start: "22:00", end: "24:00" }] };
    expect(availableSlots(input({ weeklyHours: saturday, fromDate: "2027-04-03", durationMinutes: 60, slotIntervalMinutes: 60 }))[0]!.slots).toEqual([
      "2027-04-04T01:00:00.000Z",
      "2027-04-04T02:00:00.000Z",
    ]);
  });

  it("calcula varios días seguidos y acota a 31", () => {
    const everyday = { mon: [{ start: "10:00", end: "11:00" }], tue: [{ start: "10:00", end: "11:00" }], wed: [], thu: [], fri: [], sat: [], sun: [] };
    const result = availableSlots(input({ weeklyHours: everyday, days: 100 }));
    expect(result).toHaveLength(31);
    expect(result.slice(0, 3).map((day) => [day.date, day.slots.length])).toEqual([
      ["2026-10-05", 2],
      ["2026-10-06", 2],
      ["2026-10-07", 0],
    ]);
  });
});

describe("esquemas de reservas (F5.1)", () => {
  it("el horario semanal rechaza tramos al revés o solapados, y ordena los tramos", () => {
    const ok = weeklyHoursSchema.parse({ ...EMPTY, mon: [{ start: "15:00", end: "19:00" }, { start: "09:00", end: "13:00" }] });
    expect(ok.mon.map((w) => w.start)).toEqual(["09:00", "15:00"]);
    expect(weeklyHoursSchema.safeParse({ ...EMPTY, mon: [{ start: "13:00", end: "09:00" }] }).success).toBe(false);
    expect(weeklyHoursSchema.safeParse({ ...EMPTY, mon: [{ start: "09:00", end: "13:00" }, { start: "12:00", end: "14:00" }] }).success).toBe(false);
    expect(weeklyHoursSchema.safeParse({ ...EMPTY, mon: [{ start: "9:00", end: "13:00" }] }).success).toBe(false);
    expect(weeklyHoursSchema.safeParse({ ...EMPTY, mon: [{ start: "20:00", end: "24:00" }] }).success).toBe(true);
  });

  it("la configuración por defecto es válida y se rechazan valores fuera de rango", () => {
    expect(bookingSettingsSchema.safeParse(DEFAULT_BOOKING_SETTINGS).success).toBe(true);
    expect(bookingSettingsSchema.safeParse({ ...DEFAULT_BOOKING_SETTINGS, timeZone: "Luna/Base" }).success).toBe(false);
    expect(bookingSettingsSchema.safeParse({ ...DEFAULT_BOOKING_SETTINGS, slotIntervalMinutes: 7 }).success).toBe(false);
    expect(bookingSettingsSchema.safeParse({ ...DEFAULT_BOOKING_SETTINGS, maxAdvanceDays: 0 }).success).toBe(false);
  });

  it("un servicio exige precio completo y un enlace de pago seguro", () => {
    expect(bookableServiceSchema.safeParse({ name: "Corte", durationMinutes: 30, priceAmount: 12000, priceCurrency: "clp" }).data?.priceCurrency).toBe("CLP");
    expect(bookableServiceSchema.safeParse({ name: "Corte", durationMinutes: 30, priceAmount: 12000 }).success).toBe(false);
    expect(bookableServiceSchema.safeParse({ name: "Corte", durationMinutes: 3 }).success).toBe(false);
    expect(bookableServiceSchema.safeParse({ name: "Corte", durationMinutes: 30, paymentUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(bookableServiceSchema.safeParse({ name: "Corte", durationMinutes: 30, paymentUrl: "https://link.mercadopago.cl/corte" }).success).toBe(true);
  });

  it("un bloqueo termina después de empezar y dura hasta un año", () => {
    expect(bookingBlackoutSchema.safeParse({ startsAt: "2026-12-24T00:00:00-03:00", endsAt: "2026-12-26T00:00:00-03:00", reason: "Navidad" }).success).toBe(true);
    expect(bookingBlackoutSchema.safeParse({ startsAt: "2026-12-26T00:00:00-03:00", endsAt: "2026-12-24T00:00:00-03:00" }).success).toBe(false);
    expect(bookingBlackoutSchema.safeParse({ startsAt: "2026-01-01T00:00:00Z", endsAt: "2028-01-01T00:00:00Z" }).success).toBe(false);
  });
});
