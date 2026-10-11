import { describe, expect, it } from "vitest";
import { createReportScheduleSchema, latestOccurrence, nextScheduledRun, runKey, scheduledPeriod, updateReportScheduleSchema } from "./schedule.js";

const at = (iso: string) => new Date(iso);

describe("nextScheduledRun", () => {
  it("semanal: el próximo lunes 08:00 UTC, estrictamente posterior", () => {
    // 2026-10-11 es domingo → lunes 12.
    expect(nextScheduledRun("WEEKLY", at("2026-10-11T12:00:00Z")).toISOString()).toBe("2026-10-12T08:00:00.000Z");
    // Lunes antes de las 08:00 → ese mismo lunes; lunes a las 08:00 en punto → el siguiente.
    expect(nextScheduledRun("WEEKLY", at("2026-10-12T07:59:00Z")).toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(nextScheduledRun("WEEKLY", at("2026-10-12T08:00:00Z")).toISOString()).toBe("2026-10-19T08:00:00.000Z");
    // Miércoles → lunes siguiente.
    expect(nextScheduledRun("WEEKLY", at("2026-10-14T10:00:00Z")).toISOString()).toBe("2026-10-19T08:00:00.000Z");
  });

  it("mensual: el día 1 a las 08:00 UTC, también cruzando el año", () => {
    expect(nextScheduledRun("MONTHLY", at("2026-10-11T12:00:00Z")).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(nextScheduledRun("MONTHLY", at("2026-10-01T07:00:00Z")).toISOString()).toBe("2026-10-01T08:00:00.000Z");
    expect(nextScheduledRun("MONTHLY", at("2026-10-01T08:00:00Z")).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(nextScheduledRun("MONTHLY", at("2026-12-15T00:00:00Z")).toISOString()).toBe("2027-01-01T08:00:00.000Z");
  });
});

describe("scheduledPeriod", () => {
  it("semanal: la semana completa anterior, de lunes a domingo, aunque se procese tarde", () => {
    // Corre el lunes 12 de octubre → semana del 5 al 11.
    expect(scheduledPeriod("WEEKLY", at("2026-10-12T08:00:00Z"))).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    // Procesada el jueves de esa misma semana: mismo periodo (depende de la fecha programada, no del reloj).
    expect(scheduledPeriod("WEEKLY", at("2026-10-12T08:00:00Z"))).toEqual(scheduledPeriod("WEEKLY", at("2026-10-12T08:00:00.000Z")));
    // Cruza un año.
    expect(scheduledPeriod("WEEKLY", at("2027-01-04T08:00:00Z"))).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("mensual: el mes calendario anterior, con febrero y bisiestos", () => {
    expect(scheduledPeriod("MONTHLY", at("2026-11-01T08:00:00Z"))).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(scheduledPeriod("MONTHLY", at("2026-03-01T08:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(scheduledPeriod("MONTHLY", at("2028-03-01T08:00:00Z"))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(scheduledPeriod("MONTHLY", at("2027-01-01T08:00:00Z"))).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("latestOccurrence y clave de idempotencia", () => {
  it("tras un tiempo sin correr, salta a la ocurrencia más reciente (no inunda con las atrasadas)", () => {
    const last = latestOccurrence("WEEKLY", at("2026-09-07T08:00:00Z"), at("2026-10-14T10:00:00Z"));
    expect(last.toISOString()).toBe("2026-10-12T08:00:00.000Z");
    // Si no pasó ninguna nueva, se queda en la conocida.
    expect(latestOccurrence("WEEKLY", at("2026-10-12T08:00:00Z"), at("2026-10-14T10:00:00Z")).toISOString()).toBe("2026-10-12T08:00:00.000Z");
  });

  it("dos ejecuciones del mismo periodo comparten clave; periodos distintos no", () => {
    const period = scheduledPeriod("WEEKLY", at("2026-10-12T08:00:00Z"));
    expect(runKey("s1", period)).toBe(runKey("s1", scheduledPeriod("WEEKLY", at("2026-10-12T09:30:00Z"))));
    expect(runKey("s1", period)).not.toBe(runKey("s1", scheduledPeriod("WEEKLY", at("2026-10-19T08:00:00Z"))));
    expect(runKey("s1", period)).not.toBe(runKey("s2", period));
  });
});

describe("esquemas", () => {
  it("normaliza destinatarios: minúsculas, sin repetidos, hasta 5", () => {
    const parsed = createReportScheduleSchema.parse({ frequency: "WEEKLY", recipients: [" Ana@Example.test ", "ana@example.test", "luis@example.test"], label: "  " });
    expect(parsed).toEqual({ frequency: "WEEKLY", recipients: ["ana@example.test", "luis@example.test"], label: null });
    const six = Array.from({ length: 6 }, (_, index) => `p${index}@example.test`);
    expect(createReportScheduleSchema.safeParse({ frequency: "WEEKLY", recipients: six }).success).toBe(false);
    expect(createReportScheduleSchema.safeParse({ frequency: "WEEKLY", recipients: [] }).success).toBe(false);
    expect(createReportScheduleSchema.safeParse({ frequency: "WEEKLY", recipients: ["no-es-correo"] }).success).toBe(false);
    expect(createReportScheduleSchema.safeParse({ frequency: "DAILY", recipients: ["a@example.test"] }).success).toBe(false);
  });

  it("una actualización necesita al menos un cambio", () => {
    expect(updateReportScheduleSchema.safeParse({}).success).toBe(false);
    expect(updateReportScheduleSchema.safeParse({ enabled: false }).success).toBe(true);
  });
});
