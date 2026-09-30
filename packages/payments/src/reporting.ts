import type { BillingCycle } from "./billing.js";

// Reportes de ingresos (F4.6d): funciones puras para la superadministración.

const SANTIAGO = "America/Santiago";

/** Fecha y hora de pared de `instant` en Chile, como `YYYY-MM-DD HH`. */
function santiagoWallClock(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SANTIAGO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}`;
}

/** Instante UTC de la medianoche de Chile del día `YYYY-MM-DD`. Chile está en UTC−3 o UTC−4 según
 *  el horario de verano (y el cambio ocurre justo a medianoche): se prueba cuál calza. */
function santiagoMidnight(day: string): Date {
  for (const offset of [-3, -4, -5, -2]) {
    const candidate = new Date(`${day}T00:00:00${offset < 0 ? "-" : "+"}${String(Math.abs(offset)).padStart(2, "0")}:00`);
    if (santiagoWallClock(candidate) === `${day} 00`) return candidate;
  }
  // Día sin medianoche (el reloj salta de 23:59 a 01:00): el mes empieza a la 01:00.
  return new Date(`${day}T00:00:00-04:00`);
}

/** Rango `[desde, hasta)` del mes `YYYY-MM` en hora de Chile: el mes contable del negocio. */
export function santiagoMonthRange(month: string): { from: Date; to: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("El mes debe tener la forma AAAA-MM.");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  const next = monthIndex === 12 ? `${year + 1}-01` : `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return { from: santiagoMidnight(`${month}-01`), to: santiagoMidnight(`${next}-01`) };
}

/** Mes en curso en Chile, `YYYY-MM`. */
export function currentSantiagoMonth(now: Date = new Date()): string {
  return santiagoWallClock(now).slice(0, 7);
}

/** Aporte de una suscripción al MRR: el precio mensual, o el anual dividido en 12 (redondeado). */
export function monthlyRecurringAmount(plan: { priceMonthly: number; priceYearly: number }, cycle: BillingCycle): number {
  return cycle === "MONTHLY" ? plan.priceMonthly : Math.round(plan.priceYearly / 12);
}

/**
 * Una celda CSV segura. Entre comillas (con las comillas internas duplicadas), y si empieza con un
 * carácter que una planilla interpreta como fórmula (`= + - @`, tabulación o retorno) se le antepone
 * un apóstrofo: el nombre de una organización lo escribe el cliente, y abrir el archivo no debe
 * ejecutar nada (inyección de fórmulas, OWASP "CSV Injection").
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function csvRow(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(",");
}
