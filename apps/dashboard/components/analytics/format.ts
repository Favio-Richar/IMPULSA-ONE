// Formato compartido del dashboard de analítica (F3.7): una sola configuración regional para que
// un mismo número se lea igual en la tarjeta, el eje, el tooltip y la tabla.

const integer = new Intl.NumberFormat("es-CL");
const compact = new Intl.NumberFormat("es-CL", { notation: "compact", maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("es-CL", { style: "percent", maximumFractionDigits: 1 });
const shortDay = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("es-CL", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });

export function formatInteger(value: number): string {
  return integer.format(value);
}

/** Cifras grandes en tarjetas: 1.284 / 12,9 mil. */
export function formatCompact(value: number): string {
  return value < 10_000 ? integer.format(value) : compact.format(value);
}

export function formatPercent(value: number): string {
  return percent.format(value);
}

/** Días `YYYY-MM-DD` (UTC, como los agregados) → "23 sept." */
export function formatShortDay(isoDay: string): string {
  return shortDay.format(new Date(`${isoDay}T00:00:00.000Z`));
}

export function formatLongDay(isoDay: string): string {
  return longDay.format(new Date(`${isoDay}T00:00:00.000Z`));
}

/** Hoy (UTC) menos `days`, en `YYYY-MM-DD`. */
export function isoDayOffset(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
