import { z } from "zod";
import { isValidTimeZone, zonedWallTimeToUtc } from "../bookings/timezone.js";

// Fecha y hora "de pared" + zona horaria (F7.3, ADR-018), para la cuenta regresiva y los eventos.
// Se guarda lo que escribió el negocio (`2026-10-12T20:00` en `America/Santiago`), no un instante
// UTC: si cambia el horario de verano, la hora sigue siendo la que el negocio anunció.

/** Zonas que ofrece el panel (mismas que las reservas). Cualquier zona IANA válida se acepta igual. */
export const SITE_TIME_ZONES = [
  { value: "America/Santiago", label: "Chile (Santiago)" },
  { value: "America/Punta_Arenas", label: "Chile (Magallanes)" },
  { value: "Pacific/Easter", label: "Chile (Isla de Pascua)" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina" },
  { value: "America/Lima", label: "Perú" },
  { value: "America/Bogota", label: "Colombia" },
  { value: "America/Mexico_City", label: "México (Centro)" },
  { value: "America/Montevideo", label: "Uruguay" },
  { value: "America/Asuncion", label: "Paraguay" },
  { value: "America/La_Paz", label: "Bolivia" },
  { value: "America/Guayaquil", label: "Ecuador" },
  { value: "America/Caracas", label: "Venezuela" },
  { value: "Europe/Madrid", label: "España" },
] as const;

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const timeZoneSchema = z.string().trim().max(64).refine(isValidTimeZone, "Elige una zona horaria válida.");

/** `AAAA-MM-DDTHH:mm` con una fecha que existe en el calendario (sin segundos ni zona). */
export const localDateTimeSchema = z
  .string()
  .trim()
  .regex(LOCAL_DATE_TIME, "Elige fecha y hora.")
  .refine((value) => {
    // Zod 4 corre este refine aunque la regex de arriba haya fallado: sin coincidencia, no hay nada
    // que revisar (el error de formato ya quedó registrado).
    const match = LOCAL_DATE_TIME.exec(value);
    if (!match) return true;
    const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 2000 && year <= 2100 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour <= 23 && minute <= 59;
  }, "Esa fecha no existe.");

/**
 * Instante UTC de una hora de pared en una zona, o `null` si no existe (salto del horario de verano)
 * o si los datos no son válidos.
 */
export function localDateTimeToInstant(local: string, timeZone: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match || !isValidTimeZone(timeZone)) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  return zonedWallTimeToUtc({ year, month, day, hour, minute }, timeZone);
}

export const NONEXISTENT_LOCAL_TIME_MESSAGE = "Esa hora no existe en esa zona (cambio de horario). Elige otra.";

/** Fecha escrita para la página pública ("sábado 12 de octubre, 20:00"), en la zona del negocio. */
export function formatLocalDateTime(local: string, timeZone: string, options: { weekday?: boolean; year?: boolean } = {}): string {
  const instant = localDateTimeToInstant(local, timeZone);
  if (!instant) return local.replace("T", " ");
  return new Intl.DateTimeFormat("es-CL", {
    timeZone,
    weekday: options.weekday ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: options.year ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}
