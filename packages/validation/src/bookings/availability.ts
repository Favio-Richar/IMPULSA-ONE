import { addDaysToDate, weekdayOf, zonedWallTimeToUtc } from "./timezone.js";

// Horarios libres (F5.1). Función pura: la API la usa con las reservas y bloqueos reales, y las
// pruebas la ejercitan con fechas fijas (incluidos los cambios de horario de Chile).

type Window = { start: string; end: string };
type WeeklyWindows = Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", readonly Window[]>;

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MINUTE = 60_000;

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface AvailabilityInput {
  timeZone: string;
  weeklyHours: WeeklyWindows;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  now: Date;
  /** Primer día local (`YYYY-MM-DD`) a calcular. */
  fromDate: string;
  /** Cuántos días desde `fromDate` (1–31). */
  days: number;
  /** Reservas y bloqueos: nada se ofrece encima (más el margen) de ellos. */
  busy: readonly BusyInterval[];
}

export interface DayAvailability {
  date: string;
  /** Horas de inicio disponibles, como instantes ISO en UTC. */
  slots: string[];
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

/** Instante UTC de `minutes` (0–1440) después de la medianoche local de `date`. */
function instantAt(date: string, minutes: number, timeZone: string): Date | null {
  const day = minutes >= 1440 ? addDaysToDate(date, 1) : date;
  const minuteOfDay = minutes % 1440;
  const [year, month, dayOfMonth] = day.split("-").map(Number) as [number, number, number];
  return zonedWallTimeToUtc({ year, month, day: dayOfMonth, hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 }, timeZone);
}

/**
 * Fin real de un tramo. Si esa hora no existe (el cierre cae en un salto de horario de verano), el
 * fin es el instante del salto, que es el primer minuto que sí existe después: en Chile, las 24:00
 * del día anterior al cambio son la 01:00 del día siguiente.
 */
function windowEnd(date: string, minutes: number, timeZone: string): Date | null {
  for (let extra = 0; extra <= 120; extra += 1) {
    const instant = instantAt(date, minutes + extra, timeZone);
    if (instant) {
      return instant;
    }
  }
  return null;
}

export function availableSlots(input: AvailabilityInput): DayAvailability[] {
  const days = Math.max(1, Math.min(31, Math.floor(input.days)));
  const earliest = input.now.getTime() + input.minNoticeMinutes * MINUTE;
  const latest = input.now.getTime() + input.maxAdvanceDays * 24 * 60 * MINUTE;
  const durationMs = input.durationMinutes * MINUTE;
  const bufferMs = input.bufferMinutes * MINUTE;
  const busy = input.busy.map((interval) => ({ start: interval.start.getTime() - bufferMs, end: interval.end.getTime() + bufferMs }));
  const result: DayAvailability[] = [];

  for (let offset = 0; offset < days; offset++) {
    const date = addDaysToDate(input.fromDate, offset);
    const windows = input.weeklyHours[WEEKDAY_KEYS[weekdayOf(date)]!] ?? [];
    const seen = new Set<number>();
    const slots: string[] = [];

    for (const window of windows) {
      const endMinutes = minutesOf(window.end);
      const end = windowEnd(date, endMinutes, input.timeZone);
      if (!end) {
        continue;
      }
      for (let minutes = minutesOf(window.start); minutes + input.durationMinutes <= endMinutes; minutes += input.slotIntervalMinutes) {
        const start = instantAt(date, minutes, input.timeZone);
        if (!start) {
          continue; // hora que no existe ese día (salto de horario de verano)
        }
        const startMs = start.getTime();
        const endMs = startMs + durationMs;
        if (seen.has(startMs) || endMs > end.getTime() || startMs < earliest || startMs > latest) {
          continue;
        }
        if (busy.some((interval) => startMs < interval.end && endMs > interval.start)) {
          continue;
        }
        seen.add(startMs);
        slots.push(start.toISOString());
      }
    }

    slots.sort();
    result.push({ date, slots });
  }
  return result;
}
