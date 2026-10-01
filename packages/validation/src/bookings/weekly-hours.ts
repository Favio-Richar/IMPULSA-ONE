import { z } from "zod";

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};
/** Cada cuántos minutos se ofrece una hora de inicio. */
export const SLOT_INTERVALS = [10, 15, 20, 30, 45, 60] as const;
export const MAX_WINDOWS_PER_DAY = 4;

/** `HH:MM` (00:00–23:59) o `24:00` como fin del día. */
export const timeOfDaySchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Usa el formato HH:MM, por ejemplo 09:30.");

export function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

export const windowSchema = z
  .object({ start: timeOfDaySchema, end: timeOfDaySchema })
  .refine((window) => window.start !== "24:00", { message: "La hora de inicio no puede ser 24:00.", path: ["start"] })
  .refine((window) => minutesOfDay(window.start) < minutesOfDay(window.end), {
    message: "La hora de término tiene que ser posterior a la de inicio.",
    path: ["end"],
  });

/** Tramos de un día: ordenados y sin solaparse. */
export const dayWindowsSchema = z
  .array(windowSchema)
  .max(MAX_WINDOWS_PER_DAY)
  .superRefine((windows, ctx) => {
    const sorted = [...windows].sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start));
    for (let i = 1; i < sorted.length; i++) {
      if (minutesOfDay(sorted[i]!.start) < minutesOfDay(sorted[i - 1]!.end)) {
        ctx.addIssue({ code: "custom", message: "Los tramos del día no pueden solaparse.", path: [i] });
      }
    }
  })
  .transform((windows) => [...windows].sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start)));

export const weeklyHoursSchema = z.object({
  mon: dayWindowsSchema,
  tue: dayWindowsSchema,
  wed: dayWindowsSchema,
  thu: dayWindowsSchema,
  fri: dayWindowsSchema,
  sat: dayWindowsSchema,
  sun: dayWindowsSchema,
});
export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

/** Horario inicial razonable: lunes a viernes 09:00–13:00 y 15:00–19:00, sábado 10:00–14:00. */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  tue: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  wed: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  thu: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  fri: [{ start: "09:00", end: "13:00" }, { start: "15:00", end: "19:00" }],
  sat: [{ start: "10:00", end: "14:00" }],
  sun: [],
};
