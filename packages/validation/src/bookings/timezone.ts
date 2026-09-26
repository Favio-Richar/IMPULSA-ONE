// Conversión entre un instante y la hora de pared de una zona horaria IANA, solo con `Intl` (sin
// dependencias). La usa el cálculo de horarios libres (F5.1), que tiene que acertar los días de
// cambio de horario: en Chile el reloj salta a medianoche (en septiembre no existe la hora 00:00 a
// 00:59 y en abril la hora 23:00 a 23:59 ocurre dos veces).

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** `true` si el runtime conoce la zona horaria (IANA, p. ej. `America/Santiago`). */
export function isValidTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Hora de pared de `instant` en `timeZone`. */
export function wallTimeOf(instant: Date, timeZone: string): WallTime {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute! };
}

/** Diferencia (ms) entre la hora de pared de `instant` en `timeZone` y UTC. */
function offsetMs(instant: number, timeZone: string): number {
  const wall = wallTimeOf(new Date(instant), timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

/**
 * Instante UTC de una hora de pared en `timeZone`, o `null` si esa hora no existe (salto de
 * horario de verano). Si ocurre dos veces (fin del horario de verano), devuelve la primera.
 */
export function zonedWallTimeToUtc(wall: WallTime, timeZone: string): Date | null {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // Un cambio de horario tiene a lo sumo dos desfases alrededor: el de 12 h antes y el de 12 h
  // después. Cada uno da un candidato; el menor que vuelva a la hora pedida es la primera ocurrencia.
  const candidates = [
    ...new Set([guess - offsetMs(guess - 12 * 3_600_000, timeZone), guess - offsetMs(guess + 12 * 3_600_000, timeZone)]),
  ].sort((a, b) => a - b);
  for (const candidate of candidates) {
    const back = wallTimeOf(new Date(candidate), timeZone);
    if (
      back.year === wall.year &&
      back.month === wall.month &&
      back.day === wall.day &&
      back.hour === wall.hour &&
      back.minute === wall.minute
    ) {
      return new Date(candidate);
    }
  }
  return null;
}

/** Fecha local `YYYY-MM-DD` más `days` días (calendario, sin zona horaria). */
export function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Día de la semana (0 = domingo) de una fecha local `YYYY-MM-DD`. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Fecha local `YYYY-MM-DD` de `instant` en `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): string {
  const wall = wallTimeOf(instant, timeZone);
  return `${wall.year}-${String(wall.month).padStart(2, "0")}-${String(wall.day).padStart(2, "0")}`;
}
